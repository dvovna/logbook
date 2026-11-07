import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { textOf } from './support/block-kit';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

// What the app sends Slack after it answered is a job (JobsService): when
// Slack fails, the job is retried later. retryJobs() runs the retries now.
describe('Jobs when Slack fails', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let hr: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Mary Manager',
    });
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
      manager_approvers_rule: ApprovalRule.Any,
      hr_approvers: [hr.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  const messagesTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id);

  const approve = async (
    approver: Tables<'users'>,
    message: Awaited<ReturnType<typeof approvalMessageTo>>,
  ) => {
    await t.slack
      .actOnMessage(
        workspace,
        approver,
        message,
        ApproverMessageActionId.Approve,
      )
      .expect(200);
    await t.idle();
  };

  it('asks an approver again when the message failed', async () => {
    t.slackApi.failNext('chat.postMessage');

    const request = await requestVacation(t, workspace, member, workWeek(2));
    await t.idle();
    expect(messagesTo(manager)).toEqual([]);

    await t.retryJobs();

    expect(messagesTo(manager)).toHaveLength(1);
    expect(
      (await workspace.rows('request_workflow_steps')).find(
        ({ request_id, slack_user_id }) =>
          request_id === request.id && slack_user_id === manager.slack_id,
      )?.slack_message_ts,
    ).toBe(messagesTo(manager)[0].ts);
  });

  // Updating the approver's message used to come before the step counted as
  // done: when it failed, the next level was never asked.
  it('asks the next level even when updating the decided message failed', async () => {
    await requestVacation(t, workspace, member, workWeek(2));
    const toManager = await approvalMessageTo(t, workspace, manager);

    t.slackApi.failNext('chat.update');
    await approve(manager, toManager);

    expect(messagesTo(hr)).toHaveLength(1);
    expect(t.slackApi.messageUpdates(workspace.token, toManager)).toEqual([]);

    await t.retryJobs();

    const updates = t.slackApi.messageUpdates(workspace.token, toManager);
    expect(updates).toHaveLength(1);
    expect(textOf(updates[0])).toContain('Approved by');
  });

  it('tells the requester of the decision once the message goes through', async () => {
    const request = await requestVacation(t, workspace, member, workWeek(2));
    await approve(manager, await approvalMessageTo(t, workspace, manager));
    const toHr = await approvalMessageTo(t, workspace, hr);

    t.slackApi.failNext('chat.postMessage');
    await approve(hr, toHr);

    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );
    const approvedNotices = () =>
      messagesTo(member).filter((message) =>
        textOf(message).includes('Your time off request was approved'),
      );
    expect(approvedNotices()).toEqual([]);

    await t.retryJobs();

    expect(approvedNotices()).toHaveLength(1);
  });

  it('does not run a job again once it succeeded', async () => {
    await requestVacation(t, workspace, member, workWeek(2));
    await approvalMessageTo(t, workspace, manager);
    const callsBefore = t.slackApi.calls.length;

    await t.retryJobs();

    expect(t.slackApi.calls).toHaveLength(callsBefore);
  });
});
