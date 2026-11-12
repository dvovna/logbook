import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { workWeek } from './support/dates';
import { openAppHomeTab } from './support/app-home';
import { submitVacationRequest } from './support/vacation-flows';

// Resolves once `condition` holds, checking every few milliseconds: unlike
// t.idle(), it doesn't wait for the work that waits for Slack.
const until = async (condition: () => boolean, timeoutMs = 2_000) => {
  const deadline = performance.now() + timeoutMs;

  while (!condition()) {
    if (performance.now() > deadline) {
      throw new Error(`Still not so after ${timeoutMs} ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

// Slack limits each method per workspace. A rate limit on a burst of DMs
// (approvers asked at once, the Monday reminder) pauses the DMs for as long
// as Slack asks, and nothing else: people's screens still change at once.
describe('Slack rate limits', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let managers: Tables<'users'>[];
  let hr: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => t.slackApi.failNext('chat.postMessage', 0));

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    managers = await Promise.all(
      ['Mary', 'Mike', 'Mona'].map((name) =>
        workspace.addUser({ role: UserRole.Manager, name: `${name} Manager` }),
      ),
    );
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const team = await workspace.addTeam({
      manager_approvers: managers.map(({ slack_id }) => slack_id),
      manager_approvers_rule: ApprovalRule.All,
      hr_approvers: [hr.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  const messagesTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id);

  it('waits out a rate limit on DMs while a click still changes the screen', async () => {
    const home = await openAppHomeTab(t, workspace, hr);
    t.slackApi.failNext('chat.postMessage', 1, 'ratelimited');

    // Three approvers and the requester get a DM at once.
    await submitVacationRequest(t, workspace, member, workWeek(2));
    await until(() => t.slackApi.failuresLeft('chat.postMessage') === 0);

    const since = t.slackApi.mark();
    await t.slack
      .actOnView(workspace, hr, home, NavigationActionId.TimeOff)
      .expect(200);
    await until(() =>
      t.slackApi
        .callsWith(workspace.token, 'views.publish', { since })
        .some(({ params }) => params.user_id === hr.slack_id),
    );

    // The screen went out while the DMs still waited for Retry-After.
    expect(
      t.slackApi.callsWith(workspace.token, 'chat.postMessage', { since }),
    ).toEqual([]);

    await t.idle();

    // After the wait every DM went out, without a job retry.
    expect(managers.map((manager) => messagesTo(manager).length)).toEqual([
      1, 1, 1,
    ]);
    expect(messagesTo(member)).toHaveLength(1);
  });
});
