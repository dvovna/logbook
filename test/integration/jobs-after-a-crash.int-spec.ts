import * as background from '@common/utils/run-in-background';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables } from '@common/types/database.types';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { ApprovalsTabActionId } from '@modules/slack/tabs/approvals/enums/approvals-tab-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { UsersService } from '@modules/users/services/users.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptDecisionsService } from '@modules/receipts/services/receipt-decisions.service';
import { seedReceipt, seedReimbursement } from './support/receipts';
import { createTestApp, ITestApp } from './support/test-app';
import { slackId, TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { textOf } from './support/block-kit';
import { addDays, workWeek } from './support/dates';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import {
  historyCsv,
  leaveFileTexts,
  shareLeaveFile,
} from './support/leave-file';
import {
  approvalMessageTo,
  requestVacation,
  VACATIONS_COMMAND,
} from './support/vacation-flows';

// A process that dies right after a change commits leaves only what the
// change's transaction saved: what it would start after the commit or its
// answer (first runs of jobs, event listeners, tab updates) never runs. The
// jobs that follow a change are saved with it, so the next process still
// does them (retryJobs); a job saved after the commit would be lost.
describe('Jobs after a crash', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => jest.restoreAllMocks());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Mary Manager',
    });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
      manager_approvers_rule: ApprovalRule.Any,
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  // Runs `action` as the last thing a process does: the work it starts in
  // the background never runs.
  const crashingAfter = async <T>(action: () => Promise<T>): Promise<T> => {
    await t.idle();
    const spies = [
      jest
        .spyOn(background, 'runInBackground')
        .mockImplementation(() => undefined),
      jest
        .spyOn(background, 'startInBackground')
        .mockImplementation(() => Promise.resolve(undefined as never)),
    ];

    try {
      return await action();
    } finally {
      spies.forEach((spy) => spy.mockRestore());
    }
  };

  const messagesTo = (user: Tables<'users'>) =>
    t.slackApi.postedMessages(workspace.token, user.slack_id);

  it('asks the approver of a request made just before', async () => {
    const since = t.slackApi.mark();
    await t.slack
      .command(VACATIONS_COMMAND, workspace, member, 'request')
      .expect(acknowledged);
    await t.idle();
    const form = t.slackApi.openedModal(workspace.token, { since });
    const { start, end } = workWeek(2);

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, member, form, {
          start_date: start,
          end_date: end,
          type_option: VacationType.AnnualLeave,
        })
        .expect(200),
    );

    expect(await workspace.rows('vacation_requests')).toHaveLength(1);
    expect(messagesTo(manager)).toEqual([]);

    await t.retryJobs();

    expect(messagesTo(manager)).toHaveLength(1);
  });

  it('tells the requester of a decision that finished the request just before', async () => {
    const request = await requestVacation(t, workspace, member, workWeek(2));
    await approvalMessageTo(t, workspace, manager);
    const [step] = await workspace.rows('request_workflow_steps');
    const approver = await t.app
      .get(UsersService)
      .findOneWithValidation({ id: manager.id, slackTeamId: workspace.id });
    const decisions = () =>
      messagesTo(member).filter((message) =>
        textOf(message).includes('Your time off request was approved'),
      );

    // The approval commits with the job that finishes the request; the next
    // process runs that job, and dies once the request is approved.
    await crashingAfter(() =>
      t.app.get(RequestWorkflowService).approveStep(step.id, approver),
    );
    await crashingAfter(() => t.retryJobs());

    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );

    await t.retryJobs();

    expect(decisions()).toHaveLength(1);
  });

  it('asks again for a request HR changed just before, its old approval closed with the change', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR });
    const { start, end } = workWeek(2);
    const request = await requestVacation(t, workspace, member, {
      start,
      end,
    });
    const toManager = await approvalMessageTo(t, workspace, manager);
    const form = await openModalFrom(
      t,
      workspace,
      hr,
      await openAppHomeTab(t, workspace, hr, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]),
      VacationRequestsTabViewActionId.ManageRequestMenu,
      `${VacationRequestsTabViewActionId.EditRequest}:${request.id}`,
    );

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, hr, form, { end_date: addDays(end, -1) })
        .expect(200),
    );

    expect(
      (await workspace.rows('request_workflow_steps')).map(
        ({ completed_at }) => completed_at,
      ),
    ).toEqual([expect.any(String)]);

    await t.retryJobs();

    expect(t.slackApi.messageUpdates(workspace.token, toManager)).toHaveLength(
      1,
    );
    expect(messagesTo(manager)).toHaveLength(2);
    await t.slack
      .actOnMessage(
        workspace,
        manager,
        messagesTo(manager)[1],
        ApproverMessageActionId.Approve,
      )
      .expect(200);
    await t.idle();
    expect(await workspace.row('vacation_requests', request.id)).toMatchObject({
      status: VacationRequestStatus.Approved,
      end_date: addDays(end, -1),
    });
  });

  it('tells the requester and the recipients of a status HR set just before', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR });
    const recipient = await workspace.addUser({ name: 'Paula Payroll' });
    await t.db
      .updateTable('teams')
      .set({ approval_notification_recipients: [recipient.slack_id] })
      .where('id', '=', member.team_id!)
      .execute();
    const request = await requestVacation(t, workspace, member, workWeek(2));
    await approvalMessageTo(t, workspace, manager);
    const form = await openModalFrom(
      t,
      workspace,
      hr,
      await openAppHomeTab(t, workspace, hr, [
        NavigationActionId.TimeOff,
        NavigationActionId.AllRequests,
      ]),
      VacationRequestsTabViewActionId.ManageRequestMenu,
      `${VacationRequestsTabViewActionId.EditRequest}:${request.id}`,
    );
    const decisions = () =>
      messagesTo(member).filter((message) =>
        textOf(message).includes('Your time off request was approved'),
      );

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, hr, form, {
          status: VacationRequestStatus.Approved,
        })
        .expect(200),
    );

    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );
    expect(decisions()).toEqual([]);
    expect(messagesTo(recipient)).toEqual([]);

    await t.retryJobs();

    expect(decisions()).toHaveLength(1);
    expect(messagesTo(recipient).map(({ text }) => text)).toEqual([
      expect.stringContaining('Time off approved for *Max Member*'),
    ]);
  });

  it('tells the approver of time submitted just before', async () => {
    const website = await workspace.addProject({ name: 'Website' });
    const entry = await workspace.addTimeEntry(member, website, {
      minutes: 120,
    });
    const home = await openAppHomeTab(t, workspace, member);
    const since = t.slackApi.mark();
    const toManager = () =>
      t.slackApi
        .postedMessages(workspace.token, manager.slack_id, { since })
        .map(({ text }) => text);

    await crashingAfter(() =>
      t.slack
        .actOnView(workspace, member, home, HomeTabActionId.SubmitTimeEntries)
        .expect(200),
    );

    expect((await workspace.row('time_entries', entry.id)).status).toBe(
      TimeEntryStatus.Submitted,
    );
    expect(toManager()).toEqual([]);

    await t.retryJobs();

    expect(toManager()).toEqual([
      expect.stringContaining('submitted *1 time entry* (2h)'),
    ]);
  });

  it('tells the owner of an entry rejected just before', async () => {
    const website = await workspace.addProject({ name: 'Website' });
    const entry = await workspace.addTimeEntry(member, website, {
      status: TimeEntryStatus.Submitted,
    });
    const form = await openModalFrom(
      t,
      workspace,
      manager,
      await openAppHomeTab(t, workspace, manager, [
        NavigationActionId.Approvals,
      ]),
      ApprovalsTabActionId.RejectEntry,
      entry.id,
    );

    await crashingAfter(() =>
      t.slack
        .submitView(workspace, manager, form, { reason: 'Wrong project' })
        .expect(200),
    );

    expect((await workspace.row('time_entries', entry.id)).status).toBe(
      TimeEntryStatus.Rejected,
    );
    expect(messagesTo(member)).toEqual([]);

    await t.retryJobs();

    expect(messagesTo(member).map(({ text }) => text)).toEqual([
      expect.stringContaining('rejected your time entry'),
    ]);
  });

  it('adds a member whose join Slack sent just before', async () => {
    const id = slackId('U');
    const joined = async () =>
      (await workspace.rows('users')).find(({ slack_id }) => slack_id === id);

    await crashingAfter(() =>
      t.slack
        .event(workspace, {
          type: 'team_join',
          user: {
            id,
            team_id: workspace.slackId,
            name: 'ada',
            real_name: 'Ada Lovelace',
            profile: { email: 'ada@example.test' },
            is_admin: false,
            is_owner: false,
            is_bot: false,
            deleted: false,
          },
        })
        .expect(acknowledged),
    );

    expect(await joined()).toBeUndefined();

    await t.retryJobs();

    expect(await joined()).toMatchObject({ name: 'Ada Lovelace' });
  });

  // The click's job is saved before its answer: the file is applied, and its
  // message says so, though the process that took the click did neither.
  it('applies a leave file whose Apply was clicked just before', async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hanna HR' });
    const [preview] = await shareLeaveFile(
      t,
      workspace,
      hr,
      historyCsv(
        `Max Member,${member.email},Annual leave,2026-04-06,2026-04-10,`,
      ),
      'leave-history.csv',
    );

    await crashingAfter(() =>
      t.slack.actOnMessage(workspace, hr, preview, 'apply').expect(200),
    );
    await t.idle();

    expect(await workspace.rows('vacation_requests')).toEqual([]);
    expect(t.slackApi.messageUpdates(workspace.token, preview)).toEqual([]);

    await t.retryJobs();

    expect(
      (await workspace.rows('vacation_requests')).map(
        ({ user_id, start_date, status }) => [user_id, start_date, status],
      ),
    ).toEqual([[member.id, '2026-04-06', VacationRequestStatus.Approved]]);
    expect(
      leaveFileTexts(
        t.slackApi.messageUpdates(workspace.token, preview).pop(),
      )[0],
    ).toBe('✅ Added 1 leave for 1 person.');

    // A run after it was done does nothing more.
    await t.retryJobs();
    expect(await workspace.rows('vacation_requests')).toHaveLength(1);
  });

  it('asks someone given the HR role just before to approve a request that waited for anyone', async () => {
    // The only admin, in no team, with nobody else to approve.
    const admin = await workspace.addUser({ role: UserRole.Admin });
    const request = await requestVacation(t, workspace, admin, workWeek(2));
    await t.idle();
    expect(await workspace.rows('request_workflow_steps')).toEqual([]);
    const actor = await t.app
      .get(UsersService)
      .findOneWithValidation({ id: admin.id, slackTeamId: workspace.id });

    await crashingAfter(() =>
      t.app
        .get(UsersService)
        .update(
          { id: member.id, slackTeamId: workspace.id },
          { role: UserRole.HR },
          actor,
        ),
    );

    expect(messagesTo(member)).toEqual([]);

    await t.retryJobs();

    expect(await workspace.rows('request_workflow_steps')).toEqual([
      expect.objectContaining({
        request_id: request.id,
        slack_user_id: member.slack_id,
      }),
    ]);
    expect(messagesTo(member)).toHaveLength(1);
  });

  describe('a receipt rejected just before', () => {
    // The rejection commits with the job that tells its owner; the process
    // dies before the job runs.
    const rejectedJustBefore = async () => {
      const finance = await workspace.addUser({ role: UserRole.Finance });
      const gym = await seedReimbursement(t, workspace, { name: 'Gym' });
      const receipt = await seedReceipt(t, workspace, member, {
        reimbursement: gym,
        month: '2026-06-01',
        amountCents: 1500,
      });
      const actor = await t.app
        .get(UsersService)
        .findOneWithValidation({ id: finance.id, slackTeamId: workspace.id });

      await crashingAfter(() =>
        t.app.get(ReceiptDecisionsService).reject(receipt.id, 'Blurry', actor),
      );

      return receipt;
    };
    const dms = () =>
      messagesTo(member).filter((message) =>
        textOf(message).includes('was rejected: Blurry'),
      );

    it('tells its owner', async () => {
      await rejectedJustBefore();

      expect(dms()).toEqual([]);

      await t.retryJobs();

      expect(dms()).toHaveLength(1);
    });

    it('tells nobody when the owner sent it again meanwhile', async () => {
      const receipt = await rejectedJustBefore();

      await t.db
        .updateTable('receipts')
        .set({ status: ReceiptStatus.Submitted, rejection_reason: null })
        .where('id', '=', receipt.id)
        .execute();
      await t.retryJobs();

      expect(dms()).toEqual([]);
    });

    it('tells nobody who has been deactivated', async () => {
      await rejectedJustBefore();

      await t.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', member.id)
        .execute();
      await t.retryJobs();

      expect(dms()).toEqual([]);
    });
  });
});
