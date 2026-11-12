import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { VACATIONS_COMMAND } from './support/vacation-flows';
import { textOf } from './support/block-kit';

const DEACTIVATED =
  'Your Logbook account is deactivated. Ask HR or an admin to turn it back on.';
const UNKNOWN = "Logbook doesn't know you yet. Ask HR or an admin to add you.";

// A modal with one external select, as the forms that search for people have.
const searchForm: View = {
  type: 'modal',
  callback_id: 'admin_vacation_request',
  title: { type: 'plain_text', text: 'Request' },
  blocks: [
    {
      type: 'input',
      block_id: 'user_block',
      label: { type: 'plain_text', text: 'User' },
      element: { type: 'external_select', action_id: 'user' },
    },
  ],
};

// Slack shows "failed with the error http_service_error" for any answer but
// 200, so people Logbook can't serve get a short explanation instead.
describe('Deactivated users and people Logbook does not know', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  // A member of the Slack workspace who isn't in Logbook (yet).
  const stranger = { slack_id: 'U_STRANGER' };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  it('answers /vacations with an explanation only they see', async () => {
    const deactivated = await workspace.addUser({ is_active: false });

    const forDeactivated = await t.slack
      .command(VACATIONS_COMMAND, workspace, deactivated, 'usage')
      .expect(200);
    const forStranger = await t.slack
      .command(VACATIONS_COMMAND, workspace, stranger, 'usage')
      .expect(200);

    expect(forDeactivated.body).toEqual({
      response_type: 'ephemeral',
      text: DEACTIVATED,
    });
    expect(forStranger.body).toEqual({
      response_type: 'ephemeral',
      text: UNKNOWN,
    });
  });

  it('offers no options to search with', async () => {
    const deactivated = await workspace.addUser({
      role: UserRole.Admin,
      is_active: false,
    });

    for (const user of [deactivated, stranger]) {
      const response = await t.slack
        .suggest(workspace, user, searchForm, 'user', 'an')
        .expect(200);

      expect(response.body).toEqual({ options: [] });
    }
  });

  it('turns a submitted form into a modal that says why', async () => {
    const response = await t.slack
      .interaction({
        type: 'view_submission',
        team: { id: workspace.slackId },
        user: { id: stranger.slack_id },
        view: {
          ...searchForm,
          team_id: workspace.slackId,
          state: { values: {} },
        },
      })
      .expect(200);

    expect(response.body.response_action).toBe('update');
    expect(textOf(response.body.view)).toContain(UNKNOWN);
  });

  it('tells someone who clicks a button in a DM', async () => {
    await t.slack
      .interaction({
        type: 'block_actions',
        team: { id: workspace.slackId },
        user: { id: stranger.slack_id },
        container: { type: 'message', message_ts: '1.1' },
        channel: { id: 'D_STRANGER' },
        actions: [
          {
            type: 'button',
            action_id: 'approve',
            block_id: 'workflow_step_message',
            value: 'step',
          },
        ],
      })
      .expect(200);
    await t.idle();

    const messages = t.slackApi.postedMessages(
      workspace.token,
      stranger.slack_id,
    );
    expect(messages.map((message) => message.text)).toEqual([UNKNOWN]);
  });
});
