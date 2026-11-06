import * as request from 'supertest';
import UserRole from '@common/enums/user-role.enum';
import { TEST_SLACK_CLIENT_ID } from './support/test-env';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId } from './support/test-workspace';
import { eventually } from './support/eventually';

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

  const install = (code: string) =>
    request(t.app.getHttpServer()).get(
      `/api/slack/oauth/redirect?code=${code}`,
    );

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

    await install('code-ok').expect(302).expect('Location', '/success.html');

    expect(
      t.slackApi.calls.find(({ method }) => method === 'oauth.v2.access')
        ?.params,
    ).toMatchObject({ code: 'code-ok', client_id: TEST_SLACK_CLIENT_ID });

    const { data: slackTeam } = await t.db
      .from('slack_teams')
      .select('*')
      .eq('slack_id', teamId)
      .single();

    expect(slackTeam).toMatchObject({
      name: 'Acme',
      slack_token: `xoxb-${teamId}`,
    });

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
    await eventually(
      async () =>
        expect(
          (await usersOf()).map(({ email, role }) => ({ email, role })),
        ).toEqual(
          expect.arrayContaining([
            { email: `ivy-${teamId}@acme.test`, role: UserRole.Admin },
            { email: `max-${teamId}@acme.test`, role: UserRole.Member },
          ]),
        ),
      { timeout: 10_000 },
    );
    expect(await usersOf()).toHaveLength(2);
  });

  it('fails without creating anything when Slack rejects the code', async () => {
    const since = t.slackApi.mark();

    await install('code-unknown').expect(500);

    expect(t.slackApi.calls.slice(since).map(({ method }) => method)).toEqual([
      'oauth.v2.access',
    ]);
  });
});
