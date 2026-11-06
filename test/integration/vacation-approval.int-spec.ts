import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/request-workflows/enums/approver-message-action-id.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { eventually, settle } from './support/eventually';
import { workWeek } from './support/dates';
import { textOf } from './support/block-kit';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

describe('Vacation request approval', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Mia Manager',
    });
  });

  const addMember = async (team: Tables<'teams'>) => {
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  };

  const statusOf = async (request: Tables<'vacation_requests'>) =>
    (await workspace.row('vacation_requests', request.id)).status;

  const click = (
    approver: Tables<'users'>,
    message: Awaited<ReturnType<typeof approvalMessageTo>>,
    action: ApproverMessageActionId,
  ) => t.slack.actOnMessage(workspace, approver, message, action).expect(200);

  it('asks the manager, and tells the requester once approved', async () => {
    const recipient = await workspace.addUser({ name: 'Hana HR' });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
      approval_notification_recipients: [recipient.slack_id],
    });
    await addMember(team);
    const { start, end } = workWeek(2);

    const request = await requestVacation(t, workspace, member, {
      start,
      end,
      comment: 'Family trip',
    });

    expect(request).toMatchObject({
      status: VacationRequestStatus.Pending,
      team_id: team.id,
      end_date: end,
      days: 5,
      working_days: 5,
      user_comment: 'Family trip',
    });

    const approval = await approvalMessageTo(t, workspace, manager);
    expect(textOf(approval)).toContain('Max Member');

    await click(manager, approval, ApproverMessageActionId.Approve);

    await eventually(async () =>
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved),
    );
    await eventually(() => {
      const [notice] = t.slackApi.postedMessages(
        workspace.token,
        member.slack_id,
      );
      expect(textOf(notice)).toContain('has been approved');
    });
    await eventually(() => {
      const [notice] = t.slackApi.postedMessages(
        workspace.token,
        recipient.slack_id,
      );
      expect(textOf(notice)).toContain('Max Member');
    });
    await eventually(() => {
      const [update] = t.slackApi.messageUpdates(workspace.token, approval);
      expect(textOf(update)).toContain(`Approved by <@${manager.slack_id}>`);
    });
  });

  it('tells the requester when the manager rejects', async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    await addMember(team);

    const request = await requestVacation(t, workspace, member, workWeek(2));
    const approval = await approvalMessageTo(t, workspace, manager);

    await click(manager, approval, ApproverMessageActionId.Reject);

    await eventually(async () =>
      expect(await statusOf(request)).toBe(VacationRequestStatus.Rejected),
    );
    await eventually(() => {
      const [notice] = t.slackApi.postedMessages(
        workspace.token,
        member.slack_id,
      );
      expect(textOf(notice)).toContain('has been rejected');
    });
  });

  it('waits for every approver when the rule is ALL', async () => {
    const secondManager = await workspace.addUser({ role: UserRole.Manager });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id, secondManager.slack_id],
      manager_approvers_rule: ApprovalRule.All,
    });
    await addMember(team);

    const request = await requestVacation(t, workspace, member, workWeek(2));
    const first = await approvalMessageTo(t, workspace, manager);
    const second = await approvalMessageTo(t, workspace, secondManager);

    await click(manager, first, ApproverMessageActionId.Approve);
    await settle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);

    await click(secondManager, second, ApproverMessageActionId.Approve);
    await eventually(async () =>
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved),
    );
  });

  it('asks HR only after the managers approved', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
      hr_approvers: [hr.slack_id],
    });
    await addMember(team);

    const request = await requestVacation(t, workspace, member, workWeek(2));
    const managerApproval = await approvalMessageTo(t, workspace, manager);

    await settle();
    expect(t.slackApi.postedMessages(workspace.token, hr.slack_id)).toEqual([]);

    await click(manager, managerApproval, ApproverMessageActionId.Approve);

    const hrApproval = await approvalMessageTo(t, workspace, hr);
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);

    await click(hr, hrApproval, ApproverMessageActionId.Approve);
    await eventually(async () =>
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved),
    );
  });

  it('does not let a member approve', async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    await addMember(team);

    const request = await requestVacation(t, workspace, member, workWeek(2));
    const approval = await approvalMessageTo(t, workspace, manager);

    // The member somehow gets hold of the manager's message.
    await click(member, approval, ApproverMessageActionId.Approve);

    await settle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
  });

  describe('when an approver is away, HR approves for them', () => {
    let hr: Tables<'users'>;

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    });

    // Home → Vacations → Vacation Requests → the request's menu.
    const approveForApprovers = async (
      request: Tables<'vacation_requests'>,
    ) => {
      const requestsTab = await openAppHomeTab(t, workspace, hr, [
        AdminNavigationActionId.ManageVacations,
        AdminNavigationActionId.ManageVacationRequests,
      ]);
      const confirmation = await openModalFrom(
        t,
        workspace,
        hr,
        requestsTab,
        VacationRequestsTabViewActionId.ManageRequestMenu,
        `${VacationRequestsTabViewActionId.ApproveOnBehalf}:${request.id}`,
      );

      expect(textOf(confirmation)).toContain(
        `waiting for <@${manager.slack_id}>`,
      );

      const response = await t.slack
        .submitView(workspace, hr, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain(
        'Approved for the approvers',
      );
    };

    it('moves the request on to the next level', async () => {
      const hrApprover = await workspace.addUser({ role: UserRole.HR });
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
        hr_approvers: [hrApprover.slack_id],
      });
      await addMember(team);

      const request = await requestVacation(t, workspace, member, workWeek(2));
      const managerApproval = await approvalMessageTo(t, workspace, manager);

      await approveForApprovers(request);

      await eventually(() => {
        const [update] = t.slackApi.messageUpdates(
          workspace.token,
          managerApproval,
        );
        expect(textOf(update)).toContain(`Approved by <@${hr.slack_id}>`);
      });
      await approvalMessageTo(t, workspace, hrApprover);
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });

    it('approves the request when it was the last level', async () => {
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      await addMember(team);

      const request = await requestVacation(t, workspace, member, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      await approveForApprovers(request);

      await eventually(async () =>
        expect(await statusOf(request)).toBe(VacationRequestStatus.Approved),
      );
      await eventually(() => {
        const [notice] = t.slackApi.postedMessages(
          workspace.token,
          member.slack_id,
        );
        expect(textOf(notice)).toContain('has been approved');
      });
    });
  });

  it('approves nothing when the team has no approvers', async () => {
    const team = await workspace.addTeam();
    await addMember(team);

    const request = await requestVacation(t, workspace, member, workWeek(2));

    await settle();
    expect(await workspace.rows('request_workflow_steps')).toEqual([]);
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
  });
});
