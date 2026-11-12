import request from 'supertest';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { MemberSyncScheduleService } from '@modules/team-setup/member-sync-schedule.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { FakeSlackApiClient } from './support/fake-slack-api.client';
import { acknowledged } from './support/slack-test-client';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// Two app processes on one database and one Slack, as during a zero-downtime
// deploy: each has its own memory (the token cache, the timers), and only
// the database tells them what the other did.
describe('Two app processes at once', () => {
  let a: ITestApp;
  let b: ITestApp;
  let slack: FakeSlackApiClient;

  beforeAll(async () => {
    a = await createTestApp();
    b = await createTestApp({ slackApi: a.slackApi });
    slack = a.slackApi;
  });

  afterAll(async () => {
    await b.close();
    await a.close();
  });

  afterEach(() => jest.restoreAllMocks());

  const tokenOf = (app: ITestApp, workspace: TestWorkspace) =>
    app.app.get(AccessTokenService).getAccessToken(workspace.id);

  const refusedSince = (since: number) =>
    slack.refusedCalls.slice(since).map(({ method, token }) => ({
      method,
      token,
    }));

  describe('with a rotating token about to expire', () => {
    let workspace: TestWorkspace;
    let user: Tables<'users'>;
    let botToken: string;
    let refreshToken: string;

    beforeEach(async () => {
      workspace = await a.createWorkspace();
      user = await workspace.addUser();
      botToken = `xoxe.xoxb-${workspace.slackId}`;
      refreshToken = `xoxe-1-${workspace.slackId}`;
      slack.addOauthGrant(`rotating-${workspace.slackId}`, {
        teamId: workspace.slackId,
        teamName: 'Acme',
        botToken,
        installerId: user.slack_id,
        refreshToken,
        expiresIn: 43200,
      });
      await expireInAMinute(botToken, refreshToken);
    });

    // Within the 10 minutes before the expiry: the next call refreshes it.
    const expireInAMinute = (token: string, refresh: string) =>
      a.app.get(SlackTeamsService).saveTokens(workspace.id, {
        token,
        refreshToken: refresh,
        expiresAt: new Date(Date.now() + 60_000),
      });

    const refreshesSince = (since: number) =>
      slack
        .callsWith(undefined, 'oauth.v2.access', { since })
        .map(({ params }) => params.refresh_token);

    it('refreshes it once for both, and both use the one pair stored', async () => {
      const since = slack.mark();

      await Promise.all(
        [a, b, a, b].map(({ app }) =>
          app
            .get(SlackCommunicationService)
            .postMessage(user.slack_id, { text: 'Hi' }, workspace.id),
        ),
      );

      // Slack takes a refresh token once: a second refresh would have failed.
      expect(refreshesSince(since)).toEqual([refreshToken]);
      expect(
        slack.postedMessages(`${botToken}-r`, user.slack_id, { since }),
      ).toHaveLength(4);
      const stored = await a.app
        .get(SlackTeamsService)
        .findTokens(workspace.id);
      expect(stored).toMatchObject({
        token: `${botToken}-r`,
        refreshToken: `${refreshToken}-r`,
      });
      expect(stored!.expiresAt!.getTime() - Date.now()).toBeGreaterThan(
        43000 * 1000,
      );

      // The stored refresh token is the one Slack takes now: 12 hours later
      // the next refresh works, again once.
      await expireInAMinute(`${botToken}-r`, `${refreshToken}-r`);
      await Promise.all(
        [a, b].map(({ app }) =>
          app.get(AccessTokenService).forget(workspace.id),
        ),
      );

      expect(
        await Promise.all([tokenOf(a, workspace), tokenOf(b, workspace)]),
      ).toEqual([`${botToken}-r-r`, `${botToken}-r-r`]);
      expect(refreshesSince(since)).toEqual([
        refreshToken,
        `${refreshToken}-r`,
      ]);
    });
  });

  describe('after a reinstall in one of them', () => {
    let workspace: TestWorkspace;
    let admin: Tables<'users'>;
    const newToken = () => `xoxb-second-${workspace.slackId}`;

    beforeEach(async () => {
      workspace = await a.createWorkspace();
      admin = await workspace.addUser({ role: UserRole.Admin, name: 'Ada' });
      slack.addUser({
        id: admin.slack_id,
        teamId: workspace.slackId,
        name: 'Ada',
        email: admin.email,
      });

      // Both cache the first token.
      expect(
        await Promise.all([tokenOf(a, workspace), tokenOf(b, workspace)]),
      ).toEqual([workspace.token, workspace.token]);

      await reinstallThrough(a);
      slack.revokeToken(workspace.token);
    });

    // The OAuth redirect, in `app`: it stores the new token and clears only
    // its own cache.
    const reinstallThrough = async ({ app }: ITestApp) => {
      const code = `second-${workspace.slackId}`;
      slack.addOauthGrant(code, {
        teamId: workspace.slackId,
        teamName: 'Acme',
        botToken: newToken(),
        installerId: admin.slack_id,
      });
      const started = await request(app.getHttpServer())
        .get('/api/slack/install')
        .expect(302);
      const state = new URL(started.headers.location).searchParams.get('state');
      const cookie = ([started.headers['set-cookie']].flat() as string[])
        .find((value) => value.startsWith('slack_oauth_state='))!
        .split(';')[0];

      await request(app.getHttpServer())
        .get(`/api/slack/oauth/redirect?code=${code}&state=${state}`)
        .set('Cookie', cookie)
        .expect(302);
      await a.idle();
    };

    const openHome = async (app: ITestApp) => {
      await app.slack
        .event(
          { slackId: workspace.slackId },
          { type: 'app_home_opened', user: admin.slack_id, tab: 'home' },
        )
        .expect(acknowledged);
      await app.idle();
    };

    it('the other one drops the revoked token and calls again with the new one', async () => {
      const since = slack.mark();
      const refused = slack.refusedCalls.length;

      await openHome(b);

      expect(refusedSince(refused)).toEqual([
        { method: 'views.publish', token: workspace.token },
      ]);
      expect(
        slack.calls
          .slice(since)
          .map(({ method, token }) => ({ method, token })),
      ).toEqual([{ method: 'views.publish', token: newToken() }]);
      expect(await tokenOf(b, workspace)).toBe(newToken());

      // The one that reinstalled had cleared its cache.
      await openHome(a);
      expect(refusedSince(refused)).toHaveLength(1);
      expect(slack.homeView(newToken(), admin.slack_id)).toBeDefined();
    });

    // Its trigger_id would be gone by a second try.
    it('opens no modal with the revoked token, and the next click gets the new one', async () => {
      const refused = slack.refusedCalls.length;
      const log = () =>
        b.slack
          .command('/api/slack/log', workspace, admin)
          .expect(acknowledged)
          .then(() => b.idle());

      await log();
      expect(refusedSince(refused)).toEqual([
        { method: 'views.open', token: workspace.token },
      ]);
      expect(slack.callsWith(newToken(), 'views.open')).toEqual([]);

      await log();
      expect(refusedSince(refused)).toHaveLength(1);
      expect(slack.callsWith(newToken(), 'views.open')).toHaveLength(1);
    });
  });

  it('calls once when Slack refuses the token that is still stored', async () => {
    const workspace = await a.createWorkspace();
    const user = await workspace.addUser();
    const refused = slack.refusedCalls.length;
    slack.revokeToken(workspace.token);

    await expect(
      b.app
        .get(SlackCommunicationService)
        .postMessage(user.slack_id, { text: 'Hi' }, workspace.id),
    ).rejects.toThrow('token_revoked');

    expect(refusedSince(refused)).toEqual([
      { method: 'chat.postMessage', token: workspace.token },
    ]);
  });

  it('imports the members once a day, in whichever comes first', async () => {
    const workspace = await a.createWorkspace();
    // Other test files' workspaces share the database: only this one.
    for (const { app } of [a, b]) {
      jest
        .spyOn(app.get(SlackTeamsService), 'findInstalledIds')
        .mockResolvedValue([workspace.id]);
    }
    const since = slack.mark();
    const imports = () =>
      slack.callsWith(workspace.token, 'users.list', { since }).length;
    const bothCheck = async (now = new Date()) => {
      const synced = await Promise.all(
        [a, b].map(({ app }) =>
          app.get(MemberSyncScheduleService).syncDue(now),
        ),
      );
      await a.idle();

      return synced.sort();
    };

    expect(await bothCheck()).toEqual([0, 1]);
    expect(imports()).toBe(1);

    // The next hour's checks, and a restart's first one, import nothing.
    expect(await bothCheck(new Date(Date.now() + HOUR_MS))).toEqual([0, 0]);
    expect(imports()).toBe(1);

    expect(await bothCheck(new Date(Date.now() + DAY_MS))).toEqual([0, 1]);
    expect(imports()).toBe(2);
  });
});
