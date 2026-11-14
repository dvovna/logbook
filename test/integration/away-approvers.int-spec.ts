import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { WorkflowDecisionsService } from '@modules/request-workflows/services/workflow-decisions.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { UsersService } from '@modules/users/services/users.service';
import { formatDateRange } from '@common/utils/date.utils';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ApprovalsTabActionId } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { actOnTab, openAppHomeTab, openModalFrom } from './support/app-home';
import { buttonText, listItems } from './support/tab-readers';
import { textOf } from './support/block-kit';
import { travelTo } from './support/clock';
import { workWeek } from './support/dates';
import { AbsenceCheckService } from '@modules/request-workflows/services/absence-check.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';

describe('Approvers who are away', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  describe('who is away', () => {
    it('counts approved time off of any type that covers the day', async () => {
      const onLeave = await workspace.addUser();
      const sick = await workspace.addUser();
      const endsToday = await workspace.addUser();
      const startsToday = await workspace.addUser();
      await workspace.addVacationRequest(onLeave, {
        start_date: '2026-06-15',
        end_date: '2026-06-24',
      });
      await workspace.addVacationRequest(sick, {
        start_date: '2026-06-17',
        end_date: '2026-06-17',
        type: 'sick_leave',
      });
      await workspace.addVacationRequest(endsToday, {
        start_date: '2026-06-10',
        end_date: '2026-06-17',
      });
      await workspace.addVacationRequest(startsToday, {
        start_date: '2026-06-17',
        end_date: '2026-06-19',
      });

      const away = await t.app
        .get(UsersService)
        .findAway(workspace.id, '2026-06-17');

      expect(Object.fromEntries(away)).toEqual({
        [onLeave.slack_id]: {
          userId: onLeave.id,
          since: '2026-06-15',
          until: '2026-06-24',
        },
        [sick.slack_id]: {
          userId: sick.id,
          since: '2026-06-17',
          until: '2026-06-17',
        },
        [endsToday.slack_id]: {
          userId: endsToday.id,
          since: '2026-06-10',
          until: '2026-06-17',
        },
        [startsToday.slack_id]: {
          userId: startsToday.id,
          since: '2026-06-17',
          until: '2026-06-19',
        },
      });
    });

    it('leaves out pending, rejected, past, future and other workspaces’ time off', async () => {
      const pending = await workspace.addUser();
      const rejected = await workspace.addUser();
      const past = await workspace.addUser();
      const future = await workspace.addUser();
      await workspace.addVacationRequest(pending, {
        start_date: '2026-06-17',
        end_date: '2026-06-18',
        status: 'pending',
      });
      await workspace.addVacationRequest(rejected, {
        start_date: '2026-06-17',
        end_date: '2026-06-18',
        status: 'rejected',
      });
      await workspace.addVacationRequest(past, {
        start_date: '2026-06-10',
        end_date: '2026-06-16',
      });
      await workspace.addVacationRequest(future, {
        start_date: '2026-06-18',
        end_date: '2026-06-19',
      });
      const other = await t.createWorkspace();
      await other.addVacationRequest(await other.addUser(), {
        start_date: '2026-06-17',
        end_date: '2026-06-17',
      });

      expect(
        (await t.app.get(UsersService).findAway(workspace.id, '2026-06-17'))
          .size,
      ).toBe(0);
    });
  });

  describe('vacation requests', () => {
    let manager: Tables<'users'>;
    let hr: Tables<'users'>;
    let member: Tables<'users'>;

    beforeEach(async () => {
      manager = await workspace.addUser({
        role: UserRole.Manager,
        name: 'Mia Manager',
      });
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    });

    const addMember = async (team: Tables<'teams'>) => {
      member = await workspace.addUser({
        team_id: team.id,
        name: 'Max Member',
      });
    };

    const goAway = (
      person: Tables<'users'>,
      start = '2026-06-15',
      end = '2026-06-24',
    ) =>
      workspace.addVacationRequest(person, {
        start_date: start,
        end_date: end,
      });

    const messagesTo = (person: Tables<'users'>) =>
      t.slackApi.postedMessages(workspace.token, person.slack_id);

    const stepOf = async (person: Tables<'users'>) =>
      (await workspace.rows('request_workflow_steps')).find(
        ({ slack_user_id }) => slack_user_id === person.slack_id,
      );

    const statusOf = async (request: Tables<'vacation_requests'>) =>
      (await workspace.row('vacation_requests', request.id)).status;

    const click = (
      approver: Tables<'users'>,
      message: Awaited<ReturnType<typeof approvalMessageTo>>,
    ) =>
      t.slack
        .actOnMessage(
          workspace,
          approver,
          message,
          ApproverMessageActionId.Approve,
        )
        .expect(200);

    const skipAway = async (request: Tables<'vacation_requests'>) => {
      await t.app
        .get(RequestWorkflowService)
        .skipAway(request.id, workspace.id);
      await t.idle();
    };

    it('asks the manager at work when the other one is away (ANY)', async () => {
      const away = await workspace.addUser({ role: UserRole.Manager });
      await goAway(away);
      await addMember(
        await workspace.addTeam({
          manager_approvers: [away.slack_id, manager.slack_id],
        }),
      );

      await requestVacation(t, workspace, member, workWeek(2));

      await approvalMessageTo(t, workspace, manager);
      expect(messagesTo(away)).toEqual([]);
      const skipped = await stepOf(away);
      expect(skipped?.step_data).toMatchObject({
        status: 'skipped',
        skip_reason: 'time_off',
        away_until: '2026-06-24',
        decided_by_slack_id: null,
      });
    });

    it('asks the HR level when the only manager is away', async () => {
      await goAway(manager);
      await addMember(
        await workspace.addTeam({
          manager_approvers: [manager.slack_id],
          hr_approvers: [hr.slack_id],
          rule_set_id: null,
        }),
      );

      const request = await requestVacation(t, workspace, member, workWeek(2));

      await approvalMessageTo(t, workspace, hr);
      expect(messagesTo(manager)).toEqual([]);
      expect(messagesTo(member).map(({ text }) => text)).toEqual([
        `📨 <@${manager.slack_id}> is on time off until 24 Jun 2026, so your vacation request (${formatDateRange(request.start_date, request.end_date)}) went to <@${hr.slack_id}> (HR approval).`,
      ]);

      const details = await openModalFrom(
        t,
        workspace,
        member,
        await openAppHomeTab(t, workspace, member, [
          NavigationActionId.TimeOff,
        ]),
        VacationHistoryTabViewActionId.ManageRequestMenu,
        `${VacationHistoryTabViewActionId.ViewDetails}:${request.id}`,
      );
      expect(textOf(details)).toContain(
        `⏭️ *Skipped* · <@${manager.slack_id}> on time off until 24 Jun 2026`,
      );
    });

    it('asks HR, else the admins, when the only manager is away and there is no HR level', async () => {
      await goAway(manager);
      await addMember(
        await workspace.addTeam({ manager_approvers: [manager.slack_id] }),
      );

      await requestVacation(t, workspace, member, workWeek(2));

      await approvalMessageTo(t, workspace, hr);
      expect(await stepOf(hr)).toMatchObject({
        step_level: 2,
        step_data: { level_name: 'HR approval' },
      });

      const other = await t.createWorkspace();
      const otherManager = await other.addUser({ role: UserRole.Manager });
      const admin = await other.addUser({ role: UserRole.Admin });
      await other.addVacationRequest(otherManager, {
        start_date: '2026-06-15',
        end_date: '2026-06-24',
      });
      const team = await other.addTeam({
        manager_approvers: [otherManager.slack_id],
      });
      const otherMember = await other.addUser({ team_id: team.id });

      await requestVacation(t, other, otherMember, workWeek(2));

      await approvalMessageTo(t, other, admin);
      expect(
        (await other.rows('request_workflow_steps')).find(
          ({ slack_user_id }) => slack_user_id === admin.slack_id,
        ),
      ).toMatchObject({
        step_level: 2,
        step_data: { level_name: 'Admin approval' },
      });
    });

    it('waits only for the manager at work under ALL', async () => {
      const away = await workspace.addUser({ role: UserRole.Manager });
      await goAway(away);
      await addMember(
        await workspace.addTeam({
          manager_approvers: [away.slack_id, manager.slack_id],
          manager_approvers_rule: ApprovalRule.All,
          hr_approvers: [hr.slack_id],
          rule_set_id: null,
        }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));

      await click(manager, await approvalMessageTo(t, workspace, manager));
      await t.idle();

      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
      expect(messagesTo(away)).toEqual([]);
      await approvalMessageTo(t, workspace, hr);
      expect(messagesTo(member).slice(-1)[0].text).toBe(
        `✅ Your vacation request (${formatDateRange(request.start_date, request.end_date)}): Manager approval done by <@${manager.slack_id}>. Now waiting for HR approval from <@${hr.slack_id}>.`,
      );
    });

    it('skips the manager who goes away while the request waits', async () => {
      await addMember(
        await workspace.addTeam({
          manager_approvers: [manager.slack_id],
          hr_approvers: [hr.slack_id],
          rule_set_id: null,
        }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const managerApproval = await approvalMessageTo(t, workspace, manager);
      await goAway(manager, '2026-06-18', '2026-06-24');
      travelTo('2026-06-18');

      await skipAway(request);

      const hrApproval = await approvalMessageTo(t, workspace, hr);
      expect(messagesTo(member).slice(-1)[0].text).toBe(
        `⏭️ <@${manager.slack_id}> is on time off until 24 Jun 2026. Your vacation request (${formatDateRange(request.start_date, request.end_date)}) now waits for HR approval from <@${hr.slack_id}>.`,
      );
      expect(textOf(hrApproval)).toContain(
        `skipped <@${manager.slack_id}> (on time off until 24 Jun 2026)`,
      );
      const [update] = t.slackApi.messageUpdates(
        workspace.token,
        managerApproval,
      );
      expect(textOf(update)).toContain(
        "⏭️ Skipped while you're on time off (until 24 Jun 2026). It went on to HR approval.",
      );

      const since = t.slackApi.mark();
      await skipAway(request);

      expect(
        t.slackApi
          .callsWith(workspace.token, undefined, { since })
          .filter(({ method }) =>
            ['chat.postMessage', 'chat.update'].includes(method),
          ),
      ).toEqual([]);
    });

    it('falls back instead of approving when the last level is skipped', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      await addMember(
        await workspace.addTeam({
          manager_approvers: [manager.slack_id],
          hr_approvers: [hr.slack_id],
          rule_set_id: null,
        }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      await click(manager, await approvalMessageTo(t, workspace, manager));
      await approvalMessageTo(t, workspace, hr);
      await goAway(hr, '2026-06-18', '2026-06-24');
      travelTo('2026-06-18');

      await skipAway(request);

      await approvalMessageTo(t, workspace, admin);
      expect(await stepOf(admin)).toMatchObject({
        step_level: 3,
        step_data: { level_name: 'Admin approval' },
      });
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });

    it('changes nothing when everyone who could decide is away', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      await Promise.all([goAway(manager), goAway(hr), goAway(admin)]);
      await addMember(
        await workspace.addTeam({ manager_approvers: [manager.slack_id] }),
      );

      await requestVacation(t, workspace, member, workWeek(2));

      await approvalMessageTo(t, workspace, manager);
      expect(
        (await workspace.rows('request_workflow_steps')).map(
          ({ step_data }) => (step_data as { status: string }).status,
        ),
      ).toEqual(['pending']);
    });

    it('one outcome when the manager approves as the check skips', async () => {
      await addMember(
        await workspace.addTeam({
          manager_approvers: [manager.slack_id],
          hr_approvers: [hr.slack_id],
          rule_set_id: null,
        }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const managerApproval = await approvalMessageTo(t, workspace, manager);
      await goAway(manager, '2026-06-18', '2026-06-24');
      travelTo('2026-06-18');

      await Promise.all([click(manager, managerApproval), skipAway(request)]);
      await t.idle();

      expect(messagesTo(hr)).toHaveLength(1);
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });

    it('Approve for Approvers works on a level with skipped steps', async () => {
      const away = await workspace.addUser({ role: UserRole.Manager });
      const hrApprover = await workspace.addUser({ role: UserRole.HR });
      await goAway(away);
      await addMember(
        await workspace.addTeam({
          manager_approvers: [away.slack_id, manager.slack_id],
          manager_approvers_rule: ApprovalRule.All,
          hr_approvers: [hrApprover.slack_id],
          rule_set_id: null,
        }),
      );
      const request = await requestVacation(t, workspace, member, workWeek(2));
      await approvalMessageTo(t, workspace, manager);
      const hrViewModel = await t.app
        .get(UsersService)
        .findBySlackId(hr.slack_id, workspace.id);

      await t.app
        .get(WorkflowDecisionsService)
        .approveCurrentLevel(request.id, hrViewModel!);
      await t.idle();

      await approvalMessageTo(t, workspace, hrApprover);
      expect((await stepOf(away))?.step_data).toMatchObject({
        status: 'skipped',
      });
      expect((await stepOf(manager))?.step_data).toMatchObject({
        status: 'approved',
        decided_by_slack_id: hr.slack_id,
      });
      expect(await statusOf(request)).toBe(VacationRequestStatus.Pending);
    });
  });

  describe('requests nobody on the team can approve', () => {
    it('goes to an admin when the requester has no team and the HR person is away', async () => {
      const hr = await workspace.addUser({ role: UserRole.HR });
      const admin = await workspace.addUser({ role: UserRole.Admin });
      const requester = await workspace.addUser();
      await workspace.addVacationRequest(hr, {
        start_date: '2026-06-15',
        end_date: '2026-06-24',
      });

      await requestVacation(t, workspace, requester, workWeek(2));

      await approvalMessageTo(t, workspace, admin);
      expect(t.slackApi.postedMessages(workspace.token, hr.slack_id)).toEqual(
        [],
      );
    });
  });

  describe('the daily check and the same-day trigger', () => {
    let hr: Tables<'users'>;

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    });

    it('skips at the first check of the day, once', async () => {
      const manager = await workspace.addUser({ role: UserRole.Manager });
      const team = await workspace.addTeam({
        manager_approvers: [manager.slack_id],
        hr_approvers: [hr.slack_id],
        rule_set_id: null,
      });
      const member = await workspace.addUser({ team_id: team.id });
      await requestVacation(t, workspace, member, workWeek(2));
      await workspace.addVacationRequest(manager, {
        start_date: '2026-06-18',
        end_date: '2026-06-24',
      });
      travelTo('2026-06-18');
      const checks = t.app.get(AbsenceCheckService);

      expect(await checks.checkWorkspace(workspace.id, '2026-06-18')).toBe(
        true,
      );
      await t.idle();
      await t.retryJobs();

      expect(
        t.slackApi.postedMessages(workspace.token, hr.slack_id),
      ).toHaveLength(1);
      expect(await checks.checkWorkspace(workspace.id, '2026-06-18')).toBe(
        false,
      );
    });

    it('checks nothing before 06:00 UTC', async () => {
      expect(
        await t.app
          .get(AbsenceCheckService)
          .checkAll(new Date('2026-06-18T05:59:00Z')),
      ).toBe(0);
    });

    it('does not check an uninstalled workspace', async () => {
      await t.db
        .updateTable('slack_teams')
        .set({ uninstalled_at: new Date().toISOString() })
        .where('id', '=', workspace.id)
        .execute();

      expect(
        await t.app
          .get(AbsenceCheckService)
          .checkWorkspace(workspace.id, '2026-06-17'),
      ).toBe(false);
    });

    it('skips at once when same-day time off is approved', async () => {
      const boss = await workspace.addUser({ role: UserRole.Manager });
      const bossTeam = await workspace.addTeam({
        manager_approvers: [boss.slack_id],
      });
      const lead = await workspace.addUser({
        role: UserRole.Manager,
        team_id: bossTeam.id,
      });
      const team = await workspace.addTeam({
        manager_approvers: [lead.slack_id],
        hr_approvers: [hr.slack_id],
        rule_set_id: null,
      });
      const member = await workspace.addUser({ team_id: team.id });
      await requestVacation(t, workspace, member, workWeek(2));
      await requestVacation(t, workspace, lead, {
        start: '2026-06-17',
        end: '2026-06-19',
      });

      await t.slack
        .actOnMessage(
          workspace,
          boss,
          await approvalMessageTo(t, workspace, boss),
          ApproverMessageActionId.Approve,
        )
        .expect(200);
      await t.idle();

      expect(
        t.slackApi.postedMessages(workspace.token, hr.slack_id),
      ).toHaveLength(1);
    });
  });

  describe('time entries', () => {
    let manager: Tables<'users'>;
    let hr: Tables<'users'>;
    let member: Tables<'users'>;
    let design: Tables<'teams'>;
    let website: Tables<'projects'>;

    beforeEach(async () => {
      manager = await workspace.addUser({
        role: UserRole.Manager,
        name: 'Mia Manager',
      });
      hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
      design = await workspace.addTeam({
        name: 'Design',
        manager_approvers: [manager.slack_id],
      });
      member = await workspace.addUser({
        team_id: design.id,
        name: 'Max Member',
      });
      website = await workspace.addProject({ name: 'Website' });
    });

    const goAway = (
      person: Tables<'users'>,
      start = '2026-06-15',
      end = '2026-06-19',
    ) =>
      workspace.addVacationRequest(person, {
        start_date: start,
        end_date: end,
      });

    const submitted = (owner: Tables<'users'>) =>
      workspace.addTimeEntry(owner, website, {
        status: TimeEntryStatus.Submitted,
      });

    const approvalsOf = async (user: Tables<'users'>) =>
      buttonText(
        await openAppHomeTab(t, workspace, user),
        NavigationActionId.Approvals,
      );

    it('shows a submitted entry to HR while the team’s manager is away, and takes it back when they return', async () => {
      await goAway(manager);
      await submitted(member);

      expect(await approvalsOf(hr)).toBe('✅ Approvals (1)');
      expect(await approvalsOf(manager)).toBe('✅ Approvals (1)');
      const inbox = await openAppHomeTab(t, workspace, hr, [
        NavigationActionId.Approvals,
      ]);
      expect(listItems(inbox).map(({ title }) => title)).toEqual([
        'Max Member',
      ]);
      expect(buttonText(inbox, ApprovalsTabActionId.ApproveAll)).toBe(
        'Approve all (1)',
      );

      travelTo('2026-06-22');

      expect(await approvalsOf(hr)).toBe('✅ Approvals');
    });

    it('keeps it with the managers while one of them is at work', async () => {
      const other = await workspace.addUser({ role: UserRole.Manager });
      await t.db
        .updateTable('teams')
        .set({ manager_approvers: [manager.slack_id, other.slack_id] })
        .where('id', '=', design.id)
        .execute();
      await goAway(manager);
      await submitted(member);

      expect(await approvalsOf(hr)).toBe('✅ Approvals');
    });

    it('adds the admins while HR is away too', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      await goAway(manager);
      await goAway(hr);
      await submitted(member);

      expect(await approvalsOf(admin)).toBe('✅ Approvals (1)');
    });

    it('changes nothing when nobody who could decide is at work', async () => {
      const admin = await workspace.addUser({ role: UserRole.Admin });
      await goAway(manager);
      await goAway(hr);
      await goAway(admin);
      await submitted(member);

      expect(await approvalsOf(hr)).toBe('✅ Approvals');
      expect(await approvalsOf(admin)).toBe('✅ Approvals');
      expect(await approvalsOf(manager)).toBe('✅ Approvals (1)');
    });

    it('tells HR, not the away manager, of submitted time', async () => {
      await goAway(manager);
      await workspace.addTimeEntry(member, website);
      const since = t.slackApi.mark();

      await actOnTab(
        t,
        workspace,
        member,
        await openAppHomeTab(t, workspace, member),
        HomeTabActionId.SubmitTimeEntries,
      );
      await t.idle();

      const messagesTo = (user: Tables<'users'>) =>
        t.slackApi
          .postedMessages(workspace.token, user.slack_id, { since })
          .map(({ text }) => text);
      expect(messagesTo(hr)).toEqual([
        expect.stringContaining('submitted *1 time entry*'),
      ]);
      expect(messagesTo(manager)).toEqual([]);
    });

    it('tells HR once, on the manager’s first day off', async () => {
      await goAway(manager, '2026-06-18', '2026-06-24');
      await submitted(member);
      travelTo('2026-06-18');
      const checks = t.app.get(AbsenceCheckService);
      const textsOf = () =>
        t.slackApi
          .postedMessages(workspace.token, hr.slack_id)
          .map(({ text }) => text);

      await checks.checkWorkspace(workspace.id, '2026-06-18');
      await t.idle();
      expect(textsOf()).toEqual([
        `<@${manager.slack_id}> is on time off until 24 Jun 2026: 1 time entry of Design now waits for you in Approvals.`,
      ]);

      await checks.checkWorkspace(workspace.id, '2026-06-18');
      travelTo('2026-06-19');
      await checks.checkWorkspace(workspace.id, '2026-06-19');
      await t.idle();
      expect(textsOf()).toHaveLength(1);
    });
  });
});
