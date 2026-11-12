import UserRole from '@common/enums/user-role.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';

// On Enterprise Grid one person has the same Slack user ID in every workspace
// of the organization, so a user is always looked up together with the
// workspace the request comes from.
describe('The same Slack user in two workspaces', () => {
  let t: ITestApp;
  let first: TestWorkspace;
  let second: TestWorkspace;
  let personId: string;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    first = await t.createWorkspace();
    second = await t.createWorkspace();
    personId = slackId('U');
  });

  const askForVacationsUpload = async (workspace: TestWorkspace) => {
    const since = t.slackApi.mark();

    await t.slack
      .command('/api/slack/admin/user-vacations-upload', workspace, {
        slack_id: personId,
      })
      .expect(acknowledged);

    await t.idle();
    const [reply] = t.slackApi.ephemeralMessages(workspace.token, personId, {
      since,
    });
    expect(reply).toBeDefined();

    return textOf(reply);
  };

  it("acts with the person's role in the workspace the request comes from", async () => {
    await first.addUser({ slack_id: personId, role: UserRole.Admin });
    await second.addUser({ slack_id: personId, role: UserRole.Member });

    expect(await askForVacationsUpload(first)).toContain('user-vacations.csv');
    expect(await askForVacationsUpload(second)).toContain(
      'Only users with role',
    );
  });

  it('refuses a person the workspace does not know', async () => {
    await first.addUser({ slack_id: personId, role: UserRole.Admin });

    const response = await t.slack
      .command('/api/slack/vacations', second, { slack_id: personId }, 'usage')
      .expect(200);

    // Only an explanation, nothing from the first workspace.
    expect(response.body).toEqual({
      response_type: 'ephemeral',
      text: "Logbook doesn't know you yet. Ask HR or an admin to add you.",
    });
  });

  it('adds the person to the second workspace when they join it', async () => {
    await first.addUser({ slack_id: personId, email: 'grace@example.test' });

    await t.slack
      .event(second, {
        type: 'team_join',
        user: {
          id: personId,
          team_id: second.slackId,
          name: 'grace',
          real_name: 'Grace Hopper',
          profile: { email: 'grace@example.test' },
          is_admin: false,
          is_owner: false,
          is_bot: false,
          deleted: false,
        },
      })
      .expect(acknowledged);

    await t.idle();
    const users = await second.rows('users');
    expect(users.map(({ slack_id }) => slack_id)).toEqual([personId]);
    expect(await first.rows('users')).toHaveLength(1);
  });
});
