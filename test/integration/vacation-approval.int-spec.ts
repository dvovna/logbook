import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/request-workflows/enums/approver-message-action-id.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { VacationsTabViewActionId } from '@modules/slack/tabs/vacations/enums/vacations-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { workWeek } from './support/dates';
import { formatDateRange } from '@common/utils/date.utils';
import { textOf } from './support/block-kit';
import { sectionTexts } from './support/tab-readers';
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

  it("shows the requester's comment as typed, not as a link", async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    await addMember(team);

    await requestVacation(t, workspace, member, {
      ...workWeek(2),
      comment: '<https://evil.example|Approve here> <!channel>',
    });

    const text = textOf(await approvalMessageTo(t, workspace, manager));
    expect(text).toContain(
      '&lt;https://evil.example|Approve here&gt; &lt;!channel&gt;',
    );
    expect(text).not.toContain('<https://evil.example');
  });

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

    await t.idle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    const [requesterNotice] = t.slackApi.postedMessages(
      workspace.token,
      member.slack_id,
    );
    expect(textOf(requesterNotice)).toContain(
      'Your time off request was approved',
    );
    expect(textOf(requesterNotice)).toContain(
      `Approved by <@${manager.slack_id}>`,
    );

    const [recipientNotice] = t.slackApi.postedMessages(
      workspace.token,
      recipient.slack_id,
    );
    expect(textOf(recipientNotice)).toContain('Max Member');

    const [update] = t.slackApi.messageUpdates(workspace.token, approval);
    expect(textOf(update)).toContain(`Approved by <@${manager.slack_id}>`);
  });

  it('tells the requester when the manager rejects', async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    await addMember(team);

    const request = await requestVacation(t, workspace, member, workWeek(2));
    const approval = await approvalMessageTo(t, workspace, manager);

    await click(manager, approval, ApproverMessageActionId.Reject);

    await t.idle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Rejected);
    const [notice] = t.slackApi.postedMessages(
      workspace.token,
      member.slack_id,
    );
    expect(textOf(notice)).toContain('Your time off request was rejected');
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
    await t.idle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);

    await click(secondManager, second, ApproverMessageActionId.Approve);
    await t.idle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
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

    await t.idle();
    expect(t.slackApi.postedMessages(workspace.token, hr.slack_id)).toEqual([]);

    await click(manager, managerApproval, ApproverMessageActionId.Approve);

    const hrApproval = await approvalMessageTo(t, workspace, hr);
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);

    await click(hr, hrApproval, ApproverMessageActionId.Approve);
    await t.idle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
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

    await t.idle();
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
  });

  describe('deciding from the Vacations tab instead of the message', () => {
    // Vacations → "Requests awaiting your approval" → the request's menu.
    const decide = async (
      action:
        | VacationsTabViewActionId.ApprovePendingRequest
        | VacationsTabViewActionId.RejectPendingRequest,
    ) => {
      const [step] = await workspace.rows('request_workflow_steps');
      const vacationsTab = await openAppHomeTab(t, workspace, manager, [
        AdminNavigationActionId.ManageVacations,
      ]);
      const confirmation = await openModalFrom(
        t,
        workspace,
        manager,
        vacationsTab,
        VacationsTabViewActionId.ManagePendingRequestMenu,
        `${action}:${step.id}`,
      );

      await t.slack.submitView(workspace, manager, confirmation).expect(200);
    };

    beforeEach(async () => {
      await addMember(
        await workspace.addTeam({ manager_approvers: [manager.slack_id] }),
      );
    });

    it('lists the request under its requester, not the approver', async () => {
      const { start, end } = workWeek(2);
      await requestVacation(t, workspace, member, { start, end });

      const vacationsTab = await openAppHomeTab(t, workspace, manager, [
        AdminNavigationActionId.ManageVacations,
      ]);

      expect(sectionTexts(vacationsTab)).toContain(
        `*Max Member* · Annual Leave\n${formatDateRange(start, end)} (5 days)`,
      );
    });

    it('approves', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      await decide(VacationsTabViewActionId.ApprovePendingRequest);

      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    });

    it('rejects', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      await decide(VacationsTabViewActionId.RejectPendingRequest);

      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Rejected);
    });
  });

  describe('when an approver is away, HR approves for them', () => {
    let hr: Tables<'users'>;

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    });

    // Home → Vacations → Vacation Requests → the request's menu.
    const openConfirmation = async (request: Tables<'vacation_requests'>) => {
      const requestsTab = await openAppHomeTab(t, workspace, hr, [
        AdminNavigationActionId.ManageVacations,
        AdminNavigationActionId.ManageVacationRequests,
      ]);

      return openModalFrom(
        t,
        workspace,
        hr,
        requestsTab,
        VacationRequestsTabViewActionId.ManageRequestMenu,
        `${VacationRequestsTabViewActionId.ApproveOnBehalf}:${request.id}`,
      );
    };

    const approveForApprovers = async (
      request: Tables<'vacation_requests'>,
    ) => {
      const confirmation = await openConfirmation(request);

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

      await t.idle();
      const [update] = t.slackApi.messageUpdates(
        workspace.token,
        managerApproval,
      );
      expect(textOf(update)).toContain(`Approved by <@${hr.slack_id}>`);

      await approvalMessageTo(t, workspace, hrApprover);
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });

    it('says so when nobody has to approve the request', async () => {
      await addMember(await workspace.addTeam());
      // Pending without a workflow, as requests created before they went to
      // HR or the admins when the team had no approvers.
      const { start, end } = workWeek(2);
      const request = await workspace.addVacationRequest(member, {
        start_date: start,
        end_date: end,
        status: VacationRequestStatus.Pending,
      });

      const confirmation = await openConfirmation(request);
      expect(textOf(confirmation)).toContain('not waiting for anyone');

      const response = await t.slack
        .submitView(workspace, hr, confirmation)
        .expect(200);

      expect(textOf(response.body.view)).toContain('not waiting for anyone');
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

      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
      const [notice] = t.slackApi.postedMessages(
        workspace.token,
        member.slack_id,
      );
      expect(textOf(notice)).toContain('Your time off request was approved');
    });
  });

  // Without an approver left on the team the request would wait forever.
  describe('when nobody on the team can approve it', () => {
    const noticeTo = async (user: Tables<'users'>) => {
      await t.idle();
      const [notice] = t.slackApi.postedMessages(
        workspace.token,
        user.slack_id,
      );

      return notice?.text;
    };

    it('sends it to HR, who can approve it', async () => {
      const { start, end } = workWeek(2);
      const hr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Hana HR',
      });
      await addMember(await workspace.addTeam());

      const request = await requestVacation(t, workspace, member, workWeek(2));

      expect(await noticeTo(member)).toBe(
        `📨 Your vacation request (${start} → ${end}) went to HR for approval: your team has no other approvers.`,
      );
      await click(
        hr,
        await approvalMessageTo(t, workspace, hr),
        ApproverMessageActionId.Approve,
      );
      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    });

    it('sends it to the admins when there is no HR', async () => {
      const { start, end } = workWeek(2);
      const admin = await workspace.addUser({
        role: UserRole.Admin,
        name: 'Ada Admin',
      });
      // In no team at all.
      member = await workspace.addUser({ name: 'Max Member' });

      await requestVacation(t, workspace, member, workWeek(2));

      expect(await noticeTo(member)).toBe(
        `📨 Your vacation request (${start} → ${end}) went to the workspace admins for approval: you are not in a team.`,
      );
      expect(textOf(await approvalMessageTo(t, workspace, admin))).toContain(
        'Max Member',
      );
    });

    it("sends a team lead's own request to HR, not back to them", async () => {
      const hr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Hana HR',
      });
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      await t.db
        .from('users')
        .update({ team_id: team.id })
        .eq('id', manager.id);

      await requestVacation(
        t,
        workspace,
        { ...manager, team_id: team.id },
        workWeek(2),
      );

      expect(await approvalMessageTo(t, workspace, hr)).toBeDefined();
      expect(
        t.slackApi.postedMessages(workspace.token, manager.slack_id),
      ).toHaveLength(1);
      expect(await noticeTo(manager)).toContain('went to HR');
    });

    it('says so when nobody else can approve it', async () => {
      const { start, end } = workWeek(2);
      await addMember(await workspace.addTeam());

      const request = await requestVacation(t, workspace, member, workWeek(2));

      expect(await noticeTo(member)).toBe(
        `⚠️ Nobody can approve your vacation request (${start} → ${end}) yet: your team has no other approvers, and nobody else has the HR or Admin role. It stays pending until an admin adds approvers to your team.`,
      );
      expect(await workspace.rows('request_workflow_steps')).toEqual([]);
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });
  });
});
