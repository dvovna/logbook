import * as request from 'supertest';
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
    await t.db.from('slack_teams').delete().in('slack_id', installedTeams);
    await t.close();
  });

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

    const { data: slackTeam } = await t.db
      .from('slack_teams')
      .select('*')
      .eq('slack_id', teamId)
      .single();

    // The token is stored encrypted, and the app reads it back.
    expect(slackTeam).toMatchObject({ name: 'Acme' });
    expect(slackTeam!.slack_token).toMatch(/^v1:/);
    expect(slackTeam!.slack_token).not.toContain('xoxb');
    expect(
      await t.app.get(SlackTeamsService).findAccessToken(slackTeam!.id),
    ).toBe(`xoxb-${teamId}`);

    const usersOf = async () =>
      (await t.db.from('users').select('*').eq('slack_team_id', slackTeam!.id))
        .data!;

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

      const { data } = await t.db
        .from('slack_teams')
        .select('*')
        .eq('slack_id', teamId)
        .single();

      return { teamId, installer, slackTeam: data! };
    };

    it('keeps the data and roles and uses the new token', async () => {
      const { teamId, installer, slackTeam } = await installOnce();
      const member = slackId('U');
      await t.db.from('users').insert({
        slack_id: member,
        slack_team_id: slackTeam.id,
        name: 'Max Member',
        email: `max-${teamId}@acme.test`,
        role: UserRole.Member,
      });
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

      const { data: teams } = await t.db
        .from('slack_teams')
        .select('*')
        .eq('slack_id', teamId);
      expect(teams).toEqual([
        expect.objectContaining({ id: slackTeam.id, name: 'Acme Corp' }),
      ]);

      const { data: users } = await t.db
        .from('users')
        .select('slack_id, role')
        .eq('slack_team_id', slackTeam.id);
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

    it('lets two workspaces with the same name install', async () => {
      await installOnce('Same Name');
      await installOnce('Same Name');
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
        scope: 'commands,chat:write,files:read,users:read,users:read.email',
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
});
