import { MemberSyncScheduleService } from '@modules/team-setup/member-sync-schedule.service';
import { WELCOME_TEXT } from '@modules/team-setup/team-setup-workflow.service';
import { Logger } from '@nestjs/common';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import * as request from 'supertest';
import { ConfigService } from '@nestjs/config';
import UserRole from '@common/enums/user-role.enum';
import { TEST_SLACK_CLIENT_ID } from './support/test-env';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';

describe('Installing the app (OAuth redirect)', () => {
  let t: ITestApp;
  const installedTeams: string[] = [];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    // Not TestWorkspaces: the app created these rows itself.
    if (installedTeams.length) {
      await t.db
        .deleteFrom('slack_teams')
        .where('slack_id', 'in', installedTeams)
        .execute();
    }
    await t.close();
  });

  const workspaceRow = async (teamId: string) =>
    (await t.db
      .selectFrom('slack_teams')
      .selectAll()
      .where('slack_id', '=', teamId)
      .executeTakeFirst()) ?? null;

  // /api/slack/install: where it sends the browser and the state cookie it sets.
  const startInstall = async () => {
    const response = await request(t.app.getHttpServer())
      .get('/api/slack/install')
      .expect(302);
    const authorizeUrl = new URL(response.headers.location);
    const cookies = [response.headers['set-cookie']].flat() as string[];
    const stateCookie = cookies
      .find((cookie) => cookie.startsWith('slack_oauth_state='))!
      .split(';')[0];

    return {
      authorizeUrl,
      state: authorizeUrl.searchParams.get('state')!,
      stateCookie,
    };
  };

  // Slack sends the browser back with the code and the state.
  const redirectBack = (query: string, stateCookie?: string) => {
    const call = request(t.app.getHttpServer()).get(
      `/api/slack/oauth/redirect?${query}`,
    );

    return stateCookie ? call.set('Cookie', stateCookie) : call;
  };

  const install = async (code: string) => {
    const { state, stateCookie } = await startInstall();

    return redirectBack(`code=${code}&state=${state}`, stateCookie);
  };

  // ALLOWED_SLACK_TEAM_IDS, as if it were set in the environment.
  const allowOnly = (ids: string) => {
    const config = t.app.get(ConfigService);
    const get = config.get.bind(config);

    return jest
      .spyOn(config, 'get')
      .mockImplementation((key: string) =>
        key === 'ALLOWED_SLACK_TEAM_IDS' ? ids : get(key),
      );
  };

  it('creates the workspace with the installer as admin, then imports the members', async () => {
    const teamId = slackId('T');
    const installer = slackId('U');
    installedTeams.push(teamId);

    t.slackApi.addOauthGrant('code-ok', {
      teamId,
      teamName: 'Acme',
      botToken: `xoxb-${teamId}`,
      installerId: installer,
    });
    t.slackApi.addUser({
      id: installer,
      teamId,
      name: 'Ivy Installer',
      email: `ivy-${teamId}@acme.test`,
    });
    t.slackApi.addUser({
      id: slackId('U'),
      teamId,
      name: 'Max Member',
      email: `max-${teamId}@acme.test`,
    });
    t.slackApi.addUser({
      id: slackId('U'),
      teamId,
      name: 'Old Timer',
      email: `old-${teamId}@acme.test`,
      deleted: true,
    });
    t.slackApi.addUser({
      id: slackId('U'),
      teamId,
      name: 'Some Bot',
      email: `bot-${teamId}@acme.test`,
      isBot: true,
    });

    const response = await install('code-ok');
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/success.html');

    expect(
      t.slackApi.calls.find(({ method }) => method === 'oauth.v2.access')
        ?.params,
    ).toMatchObject({ code: 'code-ok', client_id: TEST_SLACK_CLIENT_ID });

    const slackTeam = await t.db
      .selectFrom('slack_teams')
      .selectAll()
      .where('slack_id', '=', teamId)
      .executeTakeFirstOrThrow();

    // The token is stored encrypted, and the app reads it back.
    expect(slackTeam).toMatchObject({ name: 'Acme' });
    expect(slackTeam.slack_token).toMatch(/^v1:/);
    expect(slackTeam.slack_token).not.toContain('xoxb');
    expect(
      await t.app.get(SlackTeamsService).findAccessToken(slackTeam.id),
    ).toBe(`xoxb-${teamId}`);

    const usersOf = () =>
      t.db
        .selectFrom('users')
        .selectAll()
        .where('slack_team_id', '=', slackTeam.id)
        .execute();

    expect(await usersOf()).toEqual([
      expect.objectContaining({
        slack_id: installer,
        email: `ivy-${teamId}@acme.test`,
        role: UserRole.Admin,
      }),
    ]);

    // The member import starts 5 seconds after the install.
    await t.idle();
    expect(
      (await usersOf()).map(({ email, role }) => ({ email, role })),
    ).toEqual(
      expect.arrayContaining([
        { email: `ivy-${teamId}@acme.test`, role: UserRole.Admin },
        { email: `max-${teamId}@acme.test`, role: UserRole.Member },
      ]),
    );
    expect(await usersOf()).toHaveLength(2);

    // The installer is told what to set up, in what order.
    expect(
      t.slackApi
        .postedMessages(`xoxb-${teamId}`, installer)
        .map(({ text }) => text),
    ).toEqual([WELCOME_TEXT]);
  });

  describe('again', () => {
    // A workspace installed once, with its installer as admin.
    const installOnce = async (name = 'Acme') => {
      const teamId = slackId('T');
      const installer = slackId('U');
      installedTeams.push(teamId);

      t.slackApi.addOauthGrant(`first-${teamId}`, {
        teamId,
        teamName: name,
        botToken: `xoxb-first-${teamId}`,
        installerId: installer,
      });
      t.slackApi.addUser({
        id: installer,
        teamId,
        name: 'Ivy Installer',
        email: `ivy-${teamId}@acme.test`,
      });
      expect((await install(`first-${teamId}`)).status).toBe(302);
      await t.idle();

      const slackTeam = await t.db
        .selectFrom('slack_teams')
        .selectAll()
        .where('slack_id', '=', teamId)
        .executeTakeFirstOrThrow();

      return { teamId, installer, slackTeam };
    };

    it('keeps the data and roles and uses the new token', async () => {
      const { teamId, installer, slackTeam } = await installOnce();
      const member = slackId('U');
      await t.db
        .insertInto('users')
        .values({
          slack_id: member,
          slack_team_id: slackTeam.id,
          name: 'Max Member',
          email: `max-${teamId}@acme.test`,
          role: UserRole.Member,
        })
        .execute();
      t.slackApi.addOauthGrant(`second-${teamId}`, {
        teamId,
        teamName: 'Acme Corp',
        botToken: `xoxb-second-${teamId}`,
        installerId: member,
      });

      // Opening the App Home caches the first token.
      await t.slack
        .event(
          { slackId: teamId },
          {
            type: 'app_home_opened',
            user: installer,
            tab: 'home',
          },
        )
        .expect(acknowledged);
      await t.idle();

      expect((await install(`second-${teamId}`)).status).toBe(302);
      await t.idle();

      const teams = await t.db
        .selectFrom('slack_teams')
        .selectAll()
        .where('slack_id', '=', teamId)
        .execute();
      expect(teams).toEqual([
        expect.objectContaining({ id: slackTeam.id, name: 'Acme Corp' }),
      ]);

      const users = await t.db
        .selectFrom('users')
        .select(['slack_id', 'role'])
        .where('slack_team_id', '=', slackTeam.id)
        .execute();
      expect(users).toEqual(
        expect.arrayContaining([
          { slack_id: installer, role: UserRole.Admin },
          { slack_id: member, role: UserRole.Member },
        ]),
      );
      expect(users).toHaveLength(2);

      const since = t.slackApi.mark();
      await t.slack
        .event(
          { slackId: teamId },
          {
            type: 'app_home_opened',
            user: installer,
            tab: 'home',
          },
        )
        .expect(acknowledged);
      await t.idle();
      expect(t.slackApi.calls.slice(since).map(({ token }) => token)).toEqual([
        `xoxb-second-${teamId}`,
      ]);
    });

    it('restores an uninstalled workspace with its data and syncs its members', async () => {
      const { teamId, installer, slackTeam } = await installOnce();
      const workspace = { slackId: teamId };
      // A member Logbook already has, made a manager there: the sync adds
      // the newcomer next to them and leaves them as they are.
      const teammate = slackId('U');
      t.slackApi.addUser({
        id: teammate,
        teamId,
        name: 'Tom Teammate',
        email: `tom-${teamId}@acme.test`,
      });
      await t.db
        .insertInto('users')
        .values({
          slack_team_id: slackTeam.id,
          slack_id: teammate,
          name: 'Tom Teammate',
          email: `tom-${teamId}@acme.test`,
          role: UserRole.Manager,
        })
        .execute();
      const failed = jest.spyOn(Logger.prototype, 'error');

      await t.slack
        .event(workspace, { type: 'app_uninstalled' })
        .expect(acknowledged);
      await t.idle();
      expect(await workspaceRow(teamId)).toMatchObject({
        slack_token: null,
        uninstalled_at: expect.any(String),
      });

      // Joined while the app was away.
      const newcomer = slackId('U');
      t.slackApi.addUser({
        id: newcomer,
        teamId,
        name: 'Nia Newcomer',
        email: `nia-${teamId}@acme.test`,
      });
      t.slackApi.addOauthGrant(`back-${teamId}`, {
        teamId,
        teamName: 'Acme',
        botToken: `xoxb-back-${teamId}`,
        installerId: installer,
      });
      expect((await install(`back-${teamId}`)).status).toBe(302);
      await t.idle();

      expect(await workspaceRow(teamId)).toMatchObject({
        id: slackTeam.id,
        uninstalled_at: null,
      });
      const users = await t.db
        .selectFrom('users')
        .select(['slack_id', 'role'])
        .where('slack_team_id', '=', slackTeam.id)
        .execute();
      expect(users).toEqual(
        expect.arrayContaining([
          { slack_id: installer, role: UserRole.Admin },
          { slack_id: teammate, role: UserRole.Manager },
          { slack_id: newcomer, role: UserRole.Member },
        ]),
      );
      expect(users).toHaveLength(3);
      // The import didn't fail on the users it already had.
      expect(failed).not.toHaveBeenCalled();
      failed.mockRestore();
    });

    // Slack gives up on an event the app didn't answer, e.g. a team_join
    // while it restarted: the daily sync brings that person in.
    it('brings in, once a day, a member whose join never arrived', async () => {
      const { teamId, slackTeam } = await installOnce();
      const gone = await installOnce('Gone');
      await t.slack
        .event({ slackId: gone.teamId }, { type: 'app_uninstalled' })
        .expect(acknowledged);
      await t.idle();

      const missed = slackId('U');
      t.slackApi.addUser({
        id: missed,
        teamId,
        name: 'Mia Missed',
        email: `mia-${teamId}@acme.test`,
      });

      const workspaces = t.app.get(SlackTeamsService);
      const installed = await workspaces.findInstalledIds();
      expect(installed).toContain(slackTeam.id);
      expect(installed).not.toContain(gone.slackTeam.id);

      // Other test files' workspaces share the database: sync only this one.
      jest
        .spyOn(workspaces, 'findInstalledIds')
        .mockResolvedValue([slackTeam.id]);
      expect(await t.app.get(MemberSyncScheduleService).syncAll()).toBe(1);
      await t.idle();

      expect(
        await t.db
          .selectFrom('users')
          .select(['name', 'role', 'is_active'])
          .where('slack_team_id', '=', slackTeam.id)
          .where('slack_id', '=', missed)
          .execute(),
      ).toEqual([
        { name: 'Mia Missed', role: UserRole.Member, is_active: true },
      ]);
      jest.restoreAllMocks();
    });

    it('lets two workspaces with the same name install', async () => {
      await installOnce('Same Name');
      await installOnce('Same Name');
    });
  });

  // The workspace and its first admin are one transaction.
  it('creates nothing when Slack has no email for the installer', async () => {
    const teamId = slackId('T');
    const installer = slackId('U');
    installedTeams.push(teamId);
    t.slackApi.addOauthGrant(`no-email-${teamId}`, {
      teamId,
      teamName: 'Acme',
      botToken: `xoxb-${teamId}`,
      installerId: installer,
    });
    t.slackApi.addUser({ id: installer, teamId, name: 'Ivy', email: '' });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    expect((await install(`no-email-${teamId}`)).status).toBe(500);
    expect(await workspaceRow(teamId)).toBeNull();
  });

  describe('with token rotation', () => {
    // Installed with a rotating token that expires in `expiresIn` seconds.
    const installRotating = async (expiresIn: number) => {
      const teamId = slackId('T');
      const installer = slackId('U');
      installedTeams.push(teamId);
      t.slackApi.addOauthGrant(`rotating-${teamId}`, {
        teamId,
        teamName: 'Acme',
        botToken: `xoxe.xoxb-${teamId}`,
        installerId: installer,
        refreshToken: `xoxe-1-${teamId}`,
        expiresIn,
      });
      t.slackApi.addUser({
        id: installer,
        teamId,
        name: 'Ivy Installer',
        email: `ivy-${teamId}@acme.test`,
      });
      expect((await install(`rotating-${teamId}`)).status).toBe(302);
      await t.idle();

      return { teamId, slackTeam: (await workspaceRow(teamId))! };
    };

    it('keeps the refresh token and the expiry, encrypted', async () => {
      const { teamId, slackTeam } = await installRotating(43200);

      expect(slackTeam.slack_refresh_token).toMatch(/^v1:/);
      expect(slackTeam.slack_refresh_token).not.toContain(teamId);
      expect(
        new Date(slackTeam.slack_token_expires_at!).getTime() - Date.now(),
      ).toBeGreaterThan(43000 * 1000);
    });

    it('refreshes a token about to expire, once for calls at the same time', async () => {
      const { slackTeam } = await installRotating(43200);
      const teams = t.app.get(SlackTeamsService);
      const tokens = t.app.get(AccessTokenService);
      const before = await teams.findTokens(slackTeam.id);
      // A minute left: within the margin, so the next call refreshes.
      await t.db
        .updateTable('slack_teams')
        .set({
          slack_token_expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .where('id', '=', slackTeam.id)
        .execute();
      await tokens.forget(slackTeam.id);
      const since = t.slackApi.mark();

      const got = await Promise.all([
        tokens.getAccessToken(slackTeam.id),
        tokens.getAccessToken(slackTeam.id),
        tokens.getAccessToken(slackTeam.id),
      ]);

      const after = await teams.findTokens(slackTeam.id);
      expect(after!.token).not.toBe(before!.token);
      expect(after!.refreshToken).not.toBe(before!.refreshToken);
      expect(got).toEqual([after!.token, after!.token, after!.token]);
      expect(
        t.slackApi
          .callsWith(undefined, 'oauth.v2.access', { since })
          .map(({ params }) => params.grant_type),
      ).toEqual(['refresh_token']);
      expect(after!.expiresAt!.getTime() - Date.now()).toBeGreaterThan(
        43000 * 1000,
      );
    });

    it('keeps a token from before rotation, which never expires', async () => {
      const teamId = slackId('T');
      const installer = slackId('U');
      installedTeams.push(teamId);
      t.slackApi.addOauthGrant(`plain-${teamId}`, {
        teamId,
        teamName: 'Acme',
        botToken: `xoxb-${teamId}`,
        installerId: installer,
      });
      t.slackApi.addUser({
        id: installer,
        teamId,
        name: 'Ivy',
        email: `i-${teamId}@a.test`,
      });
      await install(`plain-${teamId}`);
      // The welcome message and the member import run after the redirect.
      await t.idle();
      const slackTeam = (await workspaceRow(teamId))!;

      expect(slackTeam).toMatchObject({
        slack_refresh_token: null,
        slack_token_expires_at: null,
      });
      expect(
        await t.app.get(AccessTokenService).getAccessToken(slackTeam.id),
      ).toBe(`xoxb-${teamId}`);
    });
  });

  it('fails without creating anything when Slack rejects the code', async () => {
    const since = t.slackApi.mark();

    expect((await install('code-unknown')).status).toBe(500);

    expect(t.slackApi.calls.slice(since).map(({ method }) => method)).toEqual([
      'oauth.v2.access',
    ]);
  });

  describe('state', () => {
    const slackCallsSince = (since: number) =>
      t.slackApi.calls.slice(since).map(({ method }) => method);

    it('sends the browser to Slack with the app, its scopes and a state', async () => {
      const { authorizeUrl, state, stateCookie } = await startInstall();

      expect(authorizeUrl.origin + authorizeUrl.pathname).toBe(
        'https://slack.com/oauth/v2/authorize',
      );
      expect(Object.fromEntries(authorizeUrl.searchParams)).toMatchObject({
        client_id: TEST_SLACK_CLIENT_ID,
        scope:
          'commands,chat:write,files:read,files:write,users:read,users:read.email',
        redirect_uri: process.env.SLACK_REDIRECT_URI,
      });
      expect(state).toMatch(/^[0-9a-f]{48}$/);
      expect(stateCookie).toBe(`slack_oauth_state=${state}`);
    });

    it('refuses a redirect the browser did not start (no state cookie)', async () => {
      const { state } = await startInstall();
      const since = t.slackApi.mark();

      await redirectBack(`code=code-ok&state=${state}`).expect(400);
      expect(slackCallsSince(since)).toEqual([]);
    });

    it('refuses a state that does not match the cookie', async () => {
      const { stateCookie } = await startInstall();
      const since = t.slackApi.mark();

      await redirectBack(
        `code=code-ok&state=${'0'.repeat(48)}`,
        stateCookie,
      ).expect(400);
      expect(slackCallsSince(since)).toEqual([]);
    });

    it('stops when the user cancels on Slack', async () => {
      const { state, stateCookie } = await startInstall();
      const since = t.slackApi.mark();

      await redirectBack(
        `error=access_denied&state=${state}`,
        stateCookie,
      ).expect(400);
      expect(slackCallsSince(since)).toEqual([]);
    });
  });

  describe('with a list of allowed workspaces', () => {
    afterEach(() => jest.restoreAllMocks());

    const grant = (code: string) => {
      const teamId = slackId('T');
      const installer = slackId('U');
      installedTeams.push(teamId);
      t.slackApi.addOauthGrant(code, {
        teamId,
        teamName: 'Listed',
        botToken: `xoxb-${teamId}`,
        installerId: installer,
      });
      t.slackApi.addUser({
        id: installer,
        teamId,
        name: 'Ivy Installer',
        email: `ivy-${teamId}@listed.test`,
      });

      return teamId;
    };

    it('installs a workspace on the list', async () => {
      const teamId = grant('code-listed');
      allowOnly(`T0OTHER, ${teamId}`);

      const response = await install('code-listed');

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/success.html');
    });

    it('refuses a workspace that is not on it and undoes the install', async () => {
      const teamId = grant('code-unlisted');
      allowOnly('T0OTHER,T0MORE');

      const response = await install('code-unlisted');

      expect(response.status).toBe(403);
      expect(response.text).toContain('does not accept installs');
      expect(await workspaceRow(teamId)).toBeNull();
      expect(
        t.slackApi.callsWith(`xoxb-${teamId}`, 'auth.revoke'),
      ).toHaveLength(1);
    });
  });
});
