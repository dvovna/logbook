import * as request from 'supertest';
import UserRole from '@common/enums/user-role.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { eventually, settle } from './support/eventually';
import { acknowledged } from './support/slack-test-client';

const slackMember = (
  workspace: TestWorkspace,
  fields: { id: string; name: string; email: string; deleted?: boolean },
) => ({
  id: fields.id,
  team_id: workspace.slackId,
  name: fields.name.toLowerCase(),
  real_name: fields.name,
  profile: { email: fields.email },
  is_admin: false,
  is_owner: false,
  is_bot: false,
  deleted: fields.deleted ?? false,
});

describe('Slack events', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  it('rejects requests without a valid Slack signature', async () => {
    await request(t.app.getHttpServer())
      .post('/api/slack/events')
      .set('X-Slack-Request-Timestamp', `${Math.floor(Date.now() / 1000)}`)
      .set('X-Slack-Signature', `v0=${'0'.repeat(64)}`)
      .send({ type: 'url_verification', challenge: 'abc' })
      .expect(403);
  });

  it('answers the URL verification challenge', async () => {
    const response = await t.slack
      .rawEvent({ type: 'url_verification', challenge: 'challenge-123' })
      .expect(acknowledged);

    expect(response.body).toEqual({ challenge: 'challenge-123' });
  });

  it('adds a member who joins the workspace', async () => {
    const id = slackId('U');

    await t.slack
      .event(workspace, {
        type: 'team_join',
        user: slackMember(workspace, {
          id,
          name: 'Ada Lovelace',
          email: 'ada@example.test',
        }),
      })
      .expect(acknowledged);

    const user = await eventually(async () => {
      const users = await workspace.rows('users');
      const joined = users.find(({ slack_id }) => slack_id === id);

      expect(joined).toBeDefined();

      return joined!;
    });

    expect(user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      role: UserRole.Member,
      is_active: true,
      team_id: null,
    });
    expect(user.contract_start_date).not.toBeNull();
  });

  it("updates a member's profile and deactivates a deleted account", async () => {
    const member = await workspace.addUser({
      role: UserRole.Manager,
      contract_start_date: '2024-03-01',
    });

    await t.slack
      .event(workspace, {
        type: 'user_change',
        user: slackMember(workspace, {
          id: member.slack_id,
          name: 'Grace Hopper',
          email: 'grace@example.test',
          deleted: true,
        }),
      })
      .expect(acknowledged);

    await eventually(async () => {
      expect(await workspace.row('users', member.id)).toMatchObject({
        name: 'Grace Hopper',
        email: 'grace@example.test',
        is_active: false,
        role: UserRole.Manager,
        contract_start_date: '2024-03-01',
      });
    });
  });

  it('publishes the App Home for a known user', async () => {
    const member = await workspace.addUser();

    await t.slack
      .event(workspace, {
        type: 'app_home_opened',
        user: member.slack_id,
        channel: 'D_TEST',
        tab: 'home',
      })
      .expect(acknowledged);

    await eventually(() =>
      expect(
        t.slackApi.homeView(workspace.token, member.slack_id),
      ).toBeDefined(),
    );
  });

  it('ignores App Home opened by someone the bot does not know', async () => {
    await t.slack
      .event(workspace, {
        type: 'app_home_opened',
        user: slackId('U'),
        channel: 'D_TEST',
        tab: 'home',
      })
      .expect(acknowledged);

    await settle();
    expect(t.slackApi.callsWith(workspace.token)).toEqual([]);
  });

  it('deletes the workspace and all its data when the app is uninstalled', async () => {
    const team = await workspace.addTeam();
    await workspace.addUser({ team_id: team.id });

    await t.slack
      .event(workspace, { type: 'app_uninstalled' })
      .expect(acknowledged);

    await eventually(async () => {
      const { data } = await t.db
        .from('slack_teams')
        .select('id')
        .eq('id', workspace.id);

      expect(data).toEqual([]);
    });
    expect(await workspace.rows('users')).toEqual([]);
    expect(await workspace.rows('teams')).toEqual([]);
  });
});
