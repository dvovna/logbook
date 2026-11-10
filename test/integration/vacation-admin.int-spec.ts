import { actionIdsOf, modalError, noticeOf } from './support/tab-readers';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { workWeek } from './support/dates';
import { textOf } from './support/block-kit';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import {
  approvalMessageTo,
  requestVacation,
  VACATIONS_COMMAND,
} from './support/vacation-flows';
import { acknowledged } from './support/slack-test-client';

describe('Requests HR and admins manage for someone else', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;
  let manager: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    // HR is in no team, so neither their team nor their balance may count.
    hr = await workspace.addUser({ role: UserRole.HR });
    manager = await workspace.addUser({ role: UserRole.Manager });
  });

  const openRequestsTab = () =>
    openAppHomeTab(t, workspace, hr, [
      NavigationActionId.TimeOff,
      NavigationActionId.AllRequests,
    ]);

  // Vacations → Vacation Requests → Create, filled in for `user`.
  const fileRequestFor = async (user: Tables<'users'>) => {
    const requestsTab = await openRequestsTab();
    const form = await openModalFrom(
      t,
      workspace,
      hr,
      requestsTab,
      VacationRequestsTabViewActionId.CreateRequest,
    );
    const { start, end } = workWeek(2);

    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, hr, form, {
        [VacationRequestsTabViewActionId.UserField]: user.id,
        status: VacationRequestStatus.Pending,
        start_date: start,
        end_date: end,
        type_option: VacationType.AnnualLeave,
      })
      .expect(200);

    // The form closes and the tab says what happened, or the form shows why not.
    return response.body.response_action === 'clear'
      ? noticeOf(await publishedHome(t, workspace, hr, since))
      : JSON.stringify(response.body);
  };

  it("files the request in the user's team, so it goes to that team's approvers", async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    const member = await workspace.addUser({ team_id: team.id });

    expect(await fileRequestFor(member)).toBe('✅ Vacation request created.');

    const [request] = await workspace.rows('vacation_requests');
    expect(request).toMatchObject({
      user_id: member.id,
      team_id: team.id,
      status: VacationRequestStatus.Pending,
    });
    await approvalMessageTo(t, workspace, manager);
  });

  it("checks the user's balance, not HR's", async () => {
    const policy = await workspace.addVacationPolicy({
      vacation_days: 3,
      working_days: 3,
    });
    const team = await workspace.addTeam({ vacation_policy_id: policy.id });
    const member = await workspace.addUser({ team_id: team.id });

    expect(await fileRequestFor(member)).toContain(
      'Not enough vacation days. Requested: 5, available: 3',
    );
    expect(await workspace.rows('vacation_requests')).toEqual([]);
  });

  it('changes the status from Edit Request and closes the approval', async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    const member = await workspace.addUser({ team_id: team.id });
    const request = await requestVacation(t, workspace, member, workWeek(2));
    const approval = await approvalMessageTo(t, workspace, manager);

    const form = await openModalFrom(
      t,
      workspace,
      hr,
      await openRequestsTab(),
      VacationRequestsTabViewActionId.ManageRequestMenu,
      `${VacationRequestsTabViewActionId.EditRequest}:${request.id}`,
    );
    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, hr, form, {
        [VacationRequestsTabViewActionId.UserField]: member.id,
        status: VacationRequestStatus.Approved,
        start_date: request.start_date,
        end_date: request.end_date,
        type_option: VacationType.AnnualLeave,
      })
      .expect(200);

    expect(response.body).toEqual({ response_action: 'clear' });
    expect(noticeOf(await publishedHome(t, workspace, hr, since))).toBe(
      '✅ Vacation request updated.',
    );
    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );
    await t.idle();
    const [update] = t.slackApi.messageUpdates(workspace.token, approval);
    expect(textOf(update)).toContain(`Canceled by <@${hr.slack_id}>`);
  });

  it("shows HR's own request form without the user and status fields", async () => {
    const since = t.slackApi.mark();

    await t.slack
      .command(VACATIONS_COMMAND, workspace, hr, 'request')
      .expect(acknowledged);

    await t.idle();
    const form = t.slackApi.openedModal(workspace.token, { since });
    const blockIds = form.blocks.map((block) => block.block_id);

    expect(blockIds).not.toContain('user_id_block');
    expect(blockIds).not.toContain('status_block');
  });

  describe('when an admin deletes a pending request', () => {
    let admin: Tables<'users'>;
    let request: Tables<'vacation_requests'>;
    let approval: Awaited<ReturnType<typeof approvalMessageTo>>;

    beforeEach(async () => {
      admin = await workspace.addUser({ role: UserRole.Admin });
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      const member = await workspace.addUser({ team_id: team.id });
      request = await requestVacation(t, workspace, member, workWeek(2));
      approval = await approvalMessageTo(t, workspace, manager);
    });

    // All requests → the request's menu → Delete Request → Delete.
    const deleteRequest = async () => {
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, [
          NavigationActionId.TimeOff,
          NavigationActionId.AllRequests,
        ]),
        VacationRequestsTabViewActionId.ManageRequestMenu,
        `${VacationRequestsTabViewActionId.DeleteRequest}:${request.id}`,
      );
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, admin, form)
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, admin, since))).toBe(
        '✅ Vacation request deleted.',
      );
      await t.idle();
    };

    it("closes the approver's message, and a click on it does nothing", async () => {
      await deleteRequest();

      expect(await workspace.rows('vacation_requests')).toEqual([]);
      expect(await workspace.rows('request_workflow_steps')).toEqual([]);
      const updates = t.slackApi.messageUpdates(workspace.token, approval);
      expect(updates).toHaveLength(1);
      expect(textOf(updates[0])).toContain(`Deleted by <@${admin.slack_id}>`);
      expect(actionIdsOf(updates[0])).toEqual([]);

      // Slack may still deliver a click on the message as it was before.
      const since = t.slackApi.mark();
      await t.slack
        .actOnMessage(
          workspace,
          manager,
          approval,
          ApproverMessageActionId.Approve,
        )
        .expect(200);
      await t.idle();

      expect(
        t.slackApi.callsWith(workspace.token, undefined, { since }),
      ).toEqual([]);
      expect(await workspace.rows('vacation_requests')).toEqual([]);
    });

    it("updates the approver's message once Slack answers", async () => {
      t.slackApi.failNext('chat.update');

      await deleteRequest();

      expect(t.slackApi.messageUpdates(workspace.token, approval)).toEqual([]);

      await t.retryJobs();

      const updates = t.slackApi.messageUpdates(workspace.token, approval);
      expect(updates).toHaveLength(1);
      expect(textOf(updates[0])).toContain(`Deleted by <@${admin.slack_id}>`);
    });

    it("does not delete another workspace's request named in a forged menu value", async () => {
      const other = await t.createWorkspace();
      const otherMember = await other.addUser();
      const otherRequest = await requestVacation(
        t,
        other,
        otherMember,
        workWeek(2),
      );

      // Menu choices come from the client, so a choice can name any id: here a
      // request the admin's list does not have.
      const tab = await openAppHomeTab(t, workspace, admin, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]);
      const since = t.slackApi.mark();
      const value = `${VacationRequestsTabViewActionId.DeleteRequest}:${otherRequest.id}`;
      await t.slack
        .interaction({
          type: 'block_actions',
          team: { id: workspace.slackId },
          user: { id: admin.slack_id, team_id: workspace.slackId },
          trigger_id: 'trigger-forged',
          container: { type: 'view' },
          view: { team_id: workspace.slackId, ...tab },
          actions: [
            {
              type: 'overflow',
              action_id: VacationRequestsTabViewActionId.ManageRequestMenu,
              block_id: 'forged',
              action_ts: '1',
              selected_option: {
                text: { type: 'plain_text', text: value },
                value,
              },
            },
          ],
        })
        .expect(200);
      await t.idle();
      const form = t.slackApi.openedModal(workspace.token, { since });

      const response = await t.slack
        .submitView(workspace, admin, form, {})
        .expect(200);

      expect(response.body.response_action).toBe('update');
      expect(modalError(response.body.view)).toBe(
        'An error occurred while deleting. Please try again later.',
      );
      expect(
        (await other.row('vacation_requests', otherRequest.id)).status,
      ).toBe(VacationRequestStatus.Pending);
    });
  });
});
