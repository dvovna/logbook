import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { ApprovalsTabActionId } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { workWeek } from './support/dates';
import { formatDateRange } from '@common/utils/date.utils';
import { textOf } from './support/block-kit';
import { listItems, sectionTexts, noticeOf } from './support/tab-readers';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';
import { RequestWorkflowStepsRepository } from '@modules/request-workflows/repositories/request-workflow-steps.repository';

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

  // The decision is the requester's last DM: who the request went to comes
  // first.
  const lastMessageTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id).slice(-1)[0];

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
    const requesterNotice = lastMessageTo(member);
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

  it('asks the manager why on Reject, and tells the requester', async () => {
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    await addMember(team);
    const { start, end } = workWeek(2);

    const request = await requestVacation(t, workspace, member, { start, end });
    const approval = await approvalMessageTo(t, workspace, manager);

    const since = t.slackApi.mark();
    await click(manager, approval, ApproverMessageActionId.Reject);
    await t.idle();

    // Nothing is decided before the form is sent.
    expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    const form = t.slackApi.openedModal(workspace.token, { since });
    expect(sectionTexts(form)).toEqual([
      `*Max Member* · Annual Leave · ${formatDateRange(start, end)} (5 days)`,
    ]);

    const response = await t.slack
      .submitView(workspace, manager, form, {
        reason: 'Release week <!channel>',
      })
      .expect(200);
    // The form closes; the message it came from shows the rejection.
    expect(response.body).toEqual({ response_action: 'clear' });

    await t.idle();
    expect(await workspace.row('vacation_requests', request.id)).toMatchObject({
      status: VacationRequestStatus.Rejected,
      rejection_reason: 'Release week <!channel>',
    });
    const notice = lastMessageTo(member);
    expect(textOf(notice)).toContain('Your time off request was rejected');
    expect(textOf(notice)).toContain('>Release week &lt;!channel&gt;');
    expect(textOf(notice)).toContain(`Rejected by <@${manager.slack_id}>`);

    // The requester finds the reason in the history and in Details.
    const history = await openAppHomeTab(t, workspace, member, [
      NavigationActionId.TimeOff,
    ]);
    expect(listItems(history)[0].fields.Reason).toBe(
      'Release week &lt;!channel&gt;',
    );
    const details = await openModalFrom(
      t,
      workspace,
      member,
      history,
      VacationHistoryTabViewActionId.ManageRequestMenu,
      `${VacationHistoryTabViewActionId.ViewDetails}:${request.id}`,
    );
    expect(sectionTexts(details)).toContain(
      '❌ *Rejection reason:*\nRelease week &lt;!channel&gt;',
    );
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

  it('tells approvers the balance after, who else is off and where the request stands', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    const policy = await workspace.addVacationPolicy({
      vacation_days: 20,
      working_days: 20,
    });
    const team = await workspace.addTeam({
      vacation_policy_id: policy.id,
      manager_approvers: [manager.slack_id],
      hr_approvers: [hr.slack_id],
    });
    await addMember(team);
    const { start, end } = workWeek(2);
    const teammate = await workspace.addUser({
      name: 'Lea Teammate',
      team_id: team.id,
    });
    await workspace.addVacationRequest(teammate, {
      start_date: start,
      end_date: end,
    });

    await requestVacation(t, workspace, member, { start, end });
    const contextOf = (message: { blocks?: unknown }) =>
      (message.blocks as { type: string; elements?: { text: string }[] }[])
        .filter((block) => block.type === 'context')
        .map((block) => block.elements![0].text);
    const situation = `Balance after: 15 of 20 days · Also off: Lea Teammate (${formatDateRange(start, end)})`;

    const managerApproval = await approvalMessageTo(t, workspace, manager);
    expect(contextOf(managerApproval)).toEqual([`${situation} · Level 1 of 2`]);

    await click(manager, managerApproval, ApproverMessageActionId.Approve);
    const hrApproval = await approvalMessageTo(t, workspace, hr);
    expect(contextOf(hrApproval)).toEqual([
      `${situation} · Level 2 of 2 · approved by <@${manager.slack_id}>`,
    ]);
  });

  describe('what the requester hears while it waits', () => {
    const messagesTo = async (user: Tables<'users'>) => {
      await t.idle();

      return t.slackApi
        .postedMessages(workspace.token, user.slack_id)
        .map(({ text }) => text);
    };

    it('who the request went to', async () => {
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      await addMember(team);
      const { start, end } = workWeek(2);

      await requestVacation(t, workspace, member, { start, end });

      expect(await messagesTo(member)).toEqual([
        `📨 Your vacation request (${formatDateRange(start, end)}) went to <@${manager.slack_id}> (Manager approval).`,
      ]);
    });

    it('who else on the team is off then, leaving sick leave out', async () => {
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
      });
      await addMember(team);
      const { start, end } = workWeek(2);
      const lea = await workspace.addUser({
        name: 'Lea <Teammate>',
        team_id: team.id,
      });
      const sam = await workspace.addUser({
        name: 'Sam Sick',
        team_id: team.id,
      });
      await workspace.addVacationRequest(lea, {
        start_date: start,
        end_date: start,
      });
      await workspace.addVacationRequest(sam, {
        start_date: start,
        end_date: end,
        type: 'sick_leave',
      });

      await requestVacation(t, workspace, member, { start, end });

      const [notice] = await messagesTo(member);
      expect(notice).toContain(
        `\n⚠️ Also off on those days: Lea &lt;Teammate&gt; (${formatDateRange(start, start)}). Your request may be rejected because of the overlap.`,
      );
      expect(notice).not.toContain('Sam Sick');
    });

    it('that a level approved it and who decides next', async () => {
      const hr = await workspace.addUser({
        role: UserRole.HR,
        name: 'Hana HR',
      });
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
        hr_approvers: [hr.slack_id],
      });
      await addMember(team);
      const { start, end } = workWeek(2);
      await requestVacation(t, workspace, member, { start, end });

      await click(
        manager,
        await approvalMessageTo(t, workspace, manager),
        ApproverMessageActionId.Approve,
      );

      const messages = await messagesTo(member);
      expect(messages[messages.length - 1]).toBe(
        `✅ Your vacation request (${formatDateRange(start, end)}): Manager approval done by <@${manager.slack_id}>. Now waiting for HR approval from <@${hr.slack_id}>.`,
      );
    });
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

  // A decision is one statement (RequestWorkflowStepsRepository.decide): it
  // either closes the step with its status, or changes nothing.
  describe('when a decision fails or two meet', () => {
    it('keeps the step open when its decision fails, so the approver can approve again', async () => {
      await addMember(
        await workspace.addTeam({ manager_approvers: [manager.slack_id] }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const approval = await approvalMessageTo(t, workspace, manager);
      const decide = jest
        .spyOn(t.app.get(RequestWorkflowStepsRepository), 'decide')
        .mockRejectedValueOnce(new Error('connection reset'));

      await click(manager, approval, ApproverMessageActionId.Approve);
      await t.idle();
      decide.mockRestore();

      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
      const [step] = await workspace.rows('request_workflow_steps');
      expect(step).toMatchObject({
        completed_at: null,
        step_data: expect.objectContaining({ status: 'pending' }),
      });

      await click(manager, approval, ApproverMessageActionId.Approve);
      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    });

    it('retries a failed approval without another click', async () => {
      await addMember(
        await workspace.addTeam({ manager_approvers: [manager.slack_id] }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const approval = await approvalMessageTo(t, workspace, manager);
      const decide = jest
        .spyOn(t.app.get(RequestWorkflowStepsRepository), 'decide')
        .mockRejectedValueOnce(new Error('connection reset'));

      await click(manager, approval, ApproverMessageActionId.Approve);
      await t.idle();
      decide.mockRestore();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);

      // The approval is a saved job, which the queue runs again.
      await t.retryJobs();
      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    });

    it('decides once when two managers approve at the same moment', async () => {
      const secondManager = await workspace.addUser({
        role: UserRole.Manager,
      });
      await addMember(
        await workspace.addTeam({
          manager_approvers: [manager.slack_id, secondManager.slack_id],
        }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const first = await approvalMessageTo(t, workspace, manager);
      const second = await approvalMessageTo(t, workspace, secondManager);

      await Promise.all([
        click(manager, first, ApproverMessageActionId.Approve),
        click(secondManager, second, ApproverMessageActionId.Approve),
      ]);
      await t.idle();

      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
      // Both steps were closed by one decision: by the same approver.
      const deciders = new Set(
        (await workspace.rows('request_workflow_steps')).map(
          (step) =>
            (step.step_data as { decided_by_slack_id?: string })
              .decided_by_slack_id,
        ),
      );
      expect(deciders.size).toBe(1);
      const notices = t.slackApi
        .postedMessages(workspace.token, member.slack_id)
        .filter((message) => textOf(message).includes('approved'));
      expect(notices).toHaveLength(1);
    });
  });

  describe('deciding in Approvals instead of the message', () => {
    // Approvals → Time off → the request's Approve or Reject.
    const decide = async (
      action:
        | ApprovalsTabActionId.ApproveTimeOff
        | ApprovalsTabActionId.RejectTimeOff,
    ) => {
      const [step] = await workspace.rows('request_workflow_steps');
      const approvals = await openAppHomeTab(t, workspace, manager, [
        NavigationActionId.Approvals,
      ]);
      const confirmation = await openModalFrom(
        t,
        workspace,
        manager,
        approvals,
        action,
        step.id,
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

      const approvals = await openAppHomeTab(t, workspace, manager, [
        NavigationActionId.Approvals,
      ]);

      expect(listItems(approvals)).toEqual([
        expect.objectContaining({
          title: 'Max Member',
          buttons: [
            ApprovalsTabActionId.ApproveTimeOff,
            ApprovalsTabActionId.RejectTimeOff,
          ],
          menu: [
            ApprovalsTabActionId.CommentTimeOff,
            ApprovalsTabActionId.TimeOffDetails,
          ],
        }),
      ]);
      expect(textOf(approvals)).toContain(
        `Annual Leave · ${formatDateRange(start, end)} (5 days)`,
      );
    });

    it('approves', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      await decide(ApprovalsTabActionId.ApproveTimeOff);

      await t.idle();
      expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
    });

    it('rejects, a reason being optional', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(2));
      await approvalMessageTo(t, workspace, manager);

      await decide(ApprovalsTabActionId.RejectTimeOff);

      await t.idle();
      expect(
        await workspace.row('vacation_requests', request.id),
      ).toMatchObject({
        status: VacationRequestStatus.Rejected,
        rejection_reason: null,
      });
      const notice = lastMessageTo(member);
      // No quoted reason line (textOf escapes the line break).
      expect(textOf(notice)).not.toContain('\\n>');
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
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
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

      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, hr, confirmation)
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(await publishedHome(t, workspace, hr, since))).toBe(
        '✅ Approved for the approvers. The request moves on.',
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
      const notice = lastMessageTo(member);
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
        `📨 Your vacation request (${formatDateRange(start, end)}) went to HR for approval: your team has no other approvers.`,
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
        `📨 Your vacation request (${formatDateRange(start, end)}) went to the workspace admins for approval: you are not in a team.`,
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
        .updateTable('users')
        .set({ team_id: team.id })
        .where('id', '=', manager.id)
        .execute();

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
        `⚠️ Nobody can approve your vacation request (${formatDateRange(start, end)}) yet: your team has no other approvers, and nobody else has the HR or Admin role. It stays pending until an admin adds approvers to your team.`,
      );
      expect(await workspace.rows('request_workflow_steps')).toEqual([]);
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });
  });
});
