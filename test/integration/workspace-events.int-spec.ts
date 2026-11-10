import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { WorkspaceRetentionService } from '@modules/slack-teams/workspace-retention.service';
import request from 'supertest';
import UserRole from '@common/enums/user-role.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
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

  it.each([
    ['of the right length', `v0=${'0'.repeat(64)}`],
    ['shorter than a real one', 'v0=abc'],
  ])(
    'rejects requests with a wrong Slack signature %s',
    async (_, signature) => {
      await request(t.app.getHttpServer())
        .post('/api/slack/events')
        .set('X-Slack-Request-Timestamp', `${Math.floor(Date.now() / 1000)}`)
        .set('X-Slack-Signature', signature)
        .send({ type: 'url_verification', challenge: 'abc' })
        .expect(403);
    },
  );

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

    await t.idle();
    const user = (await workspace.rows('users')).find(
      ({ slack_id }) => slack_id === id,
    );

    expect(user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.test',
      role: UserRole.Member,
      is_active: true,
      team_id: null,
    });
    expect(user?.contract_start_date).not.toBeNull();
  });

  // An app's bot joins the workspace when the app is installed.
  it('leaves out bots and accounts without an email that join', async () => {
    const failed = jest.spyOn(Logger.prototype, 'error');
    const bot = slackId('U');
    const noEmail = slackId('U');

    for (const user of [
      {
        ...slackMember(workspace, { id: bot, name: 'Some app', email: '' }),
        is_bot: true,
        profile: {},
      },
      {
        ...slackMember(workspace, { id: noEmail, name: 'Guest', email: '' }),
        profile: {},
      },
    ]) {
      await t.slack
        .event(workspace, { type: 'team_join', user })
        .expect(acknowledged);
    }

    await t.idle();
    const ids = (await workspace.rows('users')).map(({ slack_id }) => slack_id);

    expect(ids).not.toContain(bot);
    expect(ids).not.toContain(noEmail);
    // No job failed, so none waits to be retried.
    expect(failed).not.toHaveBeenCalled();
    failed.mockRestore();
  });

  it('adds a member who is already in another workspace', async () => {
    const otherWorkspace = await t.createWorkspace();
    await otherWorkspace.addUser({ email: 'grace@example.test' });
    const id = slackId('U');

    await t.slack
      .event(workspace, {
        type: 'team_join',
        user: slackMember(workspace, {
          id,
          name: 'Grace Hopper',
          email: 'grace@example.test',
        }),
      })
      .expect(acknowledged);

    await t.idle();
    const users = await workspace.rows('users');

    expect(users.find(({ slack_id }) => slack_id === id)).toMatchObject({
      email: 'grace@example.test',
    });
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

    await t.idle();
    expect(await workspace.row('users', member.id)).toMatchObject({
      name: 'Grace Hopper',
      email: 'grace@example.test',
      is_active: false,
      role: UserRole.Manager,
      contract_start_date: '2024-03-01',
    });
  });

  it('keeps a user deactivated in Logbook inactive after a profile change', async () => {
    const admin = await workspace.addUser({
      role: UserRole.Admin,
      is_active: false,
    });

    await t.slack
      .event(workspace, {
        type: 'user_change',
        user: slackMember(workspace, {
          id: admin.slack_id,
          name: 'New Name',
          email: admin.email,
        }),
      })
      .expect(acknowledged);

    await t.idle();
    expect(await workspace.row('users', admin.id)).toMatchObject({
      name: 'New Name',
      is_active: false,
      role: UserRole.Admin,
    });
  });

  it('keeps the role and status of a member Slack announces again', async () => {
    const known = await workspace.addUser({
      role: UserRole.HR,
      is_active: false,
      contract_start_date: '2024-03-01',
    });

    await t.slack
      .event(workspace, {
        type: 'team_join',
        user: {
          ...slackMember(workspace, {
            id: known.slack_id,
            name: 'New Name',
            email: known.email,
          }),
          is_admin: true,
        },
      })
      .expect(acknowledged);

    await t.idle();
    expect(await workspace.row('users', known.id)).toMatchObject({
      name: 'New Name',
      role: UserRole.HR,
      is_active: false,
      contract_start_date: '2024-03-01',
    });
  });

  it('adds a joining member to the workspace the event comes from', async () => {
    const otherWorkspace = await t.createWorkspace();
    const id = slackId('U');

    // On Enterprise Grid the user's own team_id can name another workspace
    // of the organization.
    await t.slack
      .event(workspace, {
        type: 'team_join',
        user: {
          ...slackMember(workspace, {
            id,
            name: 'Ada Lovelace',
            email: 'ada@example.test',
          }),
          team_id: otherWorkspace.slackId,
        },
      })
      .expect(acknowledged);

    await t.idle();
    expect(
      (await workspace.rows('users')).map(({ slack_id }) => slack_id),
    ).toContain(id);
    expect(await otherWorkspace.rows('users')).toEqual([]);
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

    await t.idle();
    expect(t.slackApi.homeView(workspace.token, member.slack_id)).toBeDefined();
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

    await t.idle();
    expect(t.slackApi.callsWith(workspace.token)).toEqual([]);
  });

  const uninstall = async () => {
    await t.slack
      .event(workspace, { type: 'app_uninstalled' })
      .expect(acknowledged);
    await t.idle();
  };

  const workspaceRow = async () =>
    (await t.db
      .selectFrom('slack_teams')
      .select(['slack_token', 'slack_refresh_token', 'uninstalled_at'])
      .where('id', '=', workspace.id)
      .executeTakeFirst()) ?? null;

  it('keeps the data of an uninstalled workspace, without its token', async () => {
    const team = await workspace.addTeam();
    await workspace.addUser({ team_id: team.id });

    await uninstall();

    expect(await workspaceRow()).toEqual({
      slack_token: null,
      slack_refresh_token: null,
      uninstalled_at: expect.any(String),
    });
    expect(await workspace.rows('users')).toHaveLength(1);
    expect(await workspace.rows('teams')).toHaveLength(1);
  });

  // The grace period is 30 days by default. Only this workspace was
  // uninstalled that long ago: the others in the database just now.
  it('deletes an uninstalled workspace and its data after the grace period', async () => {
    await workspace.addTeam();
    await uninstall();
    const daysAgo = (days: number) =>
      new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const retention = t.app.get(WorkspaceRetentionService);

    await t.db
      .updateTable('slack_teams')
      .set({ uninstalled_at: daysAgo(29) })
      .where('id', '=', workspace.id)
      .execute();
    await retention.deleteExpired();
    expect(await workspace.rows('teams')).toHaveLength(1);

    await t.db
      .updateTable('slack_teams')
      .set({ uninstalled_at: daysAgo(31) })
      .where('id', '=', workspace.id)
      .execute();
    await retention.deleteExpired();
    expect(await workspaceRow()).toBeNull();
    expect(await workspace.rows('teams')).toEqual([]);
  });

  it('deletes everything at once with UNINSTALLED_DATA_RETENTION_DAYS=0', async () => {
    await workspace.addTeam();
    const config = t.app.get(ConfigService);
    const getOrThrow = config.getOrThrow.bind(config);
    jest
      .spyOn(config, 'getOrThrow')
      .mockImplementation((key: string) =>
        key === 'UNINSTALLED_DATA_RETENTION_DAYS' ? 0 : getOrThrow(key),
      );

    await uninstall();

    expect(await workspaceRow()).toBeNull();
    expect(await workspace.rows('teams')).toEqual([]);
  });
});
