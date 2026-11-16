import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { Tables } from '@common/types/database.types';
import { formatDateList, formatDateRange } from '@common/utils/date.utils';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import { CANCEL_REQUEST_ACTION_ID } from '@modules/slack/tabs/home/views/cancel-vacation-request-select-modal.view';
import { UsersService } from '@modules/users/services/users.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { travelTo } from './support/clock';
import { workWeek } from './support/dates';
import { findAction } from './support/block-kit';
import { acknowledged } from './support/slack-test-client';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';
import {
  listItems,
  modalError,
  noticeOf,
  sectionTexts,
} from './support/tab-readers';
import {
  approvalMessageTo,
  requestVacation,
  VACATIONS_COMMAND,
} from './support/vacation-flows';

const TIME_OFF = [NavigationActionId.TimeOff];
const MENU = VacationHistoryTabViewActionId.ManageRequestMenu;
const CANCEL = VacationHistoryTabViewActionId.CancelRequest;

describe('Canceling approved time off', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let recipient: Tables<'users'>;
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
    recipient = await workspace.addUser({ name: 'Rita Recipient' });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
      approval_notification_recipients: [recipient.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id, name: 'Max Member' });
  });

  // A time off of the member's (next week by default), approved by the
  // manager in the approval DM.
  const approvedTimeOff = async (dates = workWeek(1)) => {
    const request = await requestVacation(t, workspace, member, dates);
    await t.slack
      .actOnMessage(
        workspace,
        manager,
        await approvalMessageTo(t, workspace, manager),
        ApproverMessageActionId.Approve,
      )
      .expect(200);
    await t.idle();
    expect((await workspace.row('vacation_requests', request.id)).status).toBe(
      VacationRequestStatus.Approved,
    );

    return request;
  };

  const ownItem = async (request: Tables<'vacation_requests'>) => {
    const tab = await openAppHomeTab(t, workspace, member, TIME_OFF);
    const item = listItems(tab).find(({ id }) => id === request.id);

    expect(item).toBeDefined();

    return { tab, item: item! };
  };

  const openCancel = async (request: Tables<'vacation_requests'>) => {
    const { tab } = await ownItem(request);

    return openModalFrom(
      t,
      workspace,
      member,
      tab,
      MENU,
      `${CANCEL}:${request.id}`,
    );
  };

  const statusOf = async (request: Tables<'vacation_requests'>) =>
    (await workspace.row('vacation_requests', request.id)).status;

  const dmTextsSince = (user: Tables<'users'>, since: number) =>
    t.slackApi
      .postedMessages(workspace.token, user.slack_id, { since })
      .map((message) => message.text);

  it('lets the requester cancel it from Time off, and tells who approved it and the recipients', async () => {
    const request = await approvedTimeOff();
    const { item } = await ownItem(request);

    expect(item.menuLabels).toEqual(['View Details', 'Cancel']);

    const modal = await openCancel(request);
    expect(sectionTexts(modal)).toEqual([
      `Cancel your approved time off for ${formatDateRange(request.start_date, request.end_date)}? The people who approved it, and those who hear of time off decisions, will be told.`,
    ]);

    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, member, modal)
      .expect(200);

    expect(response.body).toEqual({ response_action: 'clear' });
    const tab = await publishedHome(t, workspace, member, since);
    expect(noticeOf(tab)).toBe('✅ Vacation request canceled.');
    expect(listItems(tab).find(({ id }) => id === request.id)?.fields).toEqual(
      expect.objectContaining({ Status: '🚫 Canceled' }),
    );
    expect(await statusOf(request)).toBe(VacationRequestStatus.Canceled);

    await t.idle();
    const told = `🚫 Time off canceled for *Max Member*\n*Annual leave* · ${formatDateRange(request.start_date, request.end_date)} (5 days, 5 working)\nCanceled by <@${member.slack_id}>`;
    expect(dmTextsSince(manager, since)).toEqual([told]);
    expect(dmTextsSince(recipient, since)).toEqual([told]);
    // Nothing was logged: nothing to tell the requester, who did it.
    expect(dmTextsSince(member, since)).toEqual([]);
  });

  it('is offered for a pending request too, and not for one that has started', async () => {
    const started = await workspace.addVacationRequest(member, {
      start_date: '2026-06-15',
      end_date: '2026-06-19',
      days: 5,
      working_days: 5,
    });
    const rejected = await workspace.addVacationRequest(member, {
      start_date: '2026-07-13',
      end_date: '2026-07-17',
      days: 5,
      working_days: 5,
      status: VacationRequestStatus.Rejected,
    });
    const pending = await requestVacation(t, workspace, member, workWeek(2));
    const tab = await openAppHomeTab(t, workspace, member, TIME_OFF);
    const menuOf = (request: Tables<'vacation_requests'>) =>
      listItems(tab).find(({ id }) => id === request.id)?.menu;

    expect(menuOf(pending)).toEqual([
      VacationHistoryTabViewActionId.ViewDetails,
      CANCEL,
    ]);
    expect(menuOf(started)).toEqual([
      VacationHistoryTabViewActionId.ViewDetails,
    ]);
    expect(menuOf(rejected)).toEqual([
      VacationHistoryTabViewActionId.ViewDetails,
    ]);
  });

  it('refuses it from its first day, whatever the client sends', async () => {
    const request = await approvedTimeOff();
    const modal = await openCancel(request);

    travelTo(request.start_date);
    const response = await t.slack
      .submitView(workspace, member, modal)
      .expect(200);

    expect(response.body.response_action).toBe('update');
    expect(modalError(response.body.view)).toBe(
      "Time off that has started can't be canceled. Ask HR to change it.",
    );
    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
  });

  it("refuses someone else's time off", async () => {
    const request = await approvedTimeOff();
    const other = await workspace.addUser({ name: 'Olga Other' });
    const modal = await openCancel(request);

    const response = await t.slack
      .submitView(workspace, other, modal)
      .expect(200);

    expect(response.body.response_action).toBe('update');
    expect(modalError(response.body.view)).toBe(
      'You can cancel only your own vacation requests',
    );
    expect(await statusOf(request)).toBe(VacationRequestStatus.Approved);
  });

  it('offers approved time off that has not started in /vacations cancel', async () => {
    const approved = await approvedTimeOff();
    const pending = await requestVacation(t, workspace, member, workWeek(3));
    const since = t.slackApi.mark();

    await t.slack
      .command(VACATIONS_COMMAND, workspace, member, 'cancel')
      .expect(acknowledged);
    await t.idle();
    const modal = t.slackApi.openedModal(workspace.token, { since });

    expect(
      findAction(modal.blocks, CANCEL_REQUEST_ACTION_ID).element.options.map(
        ({ value }: { value: string }) => value,
      ),
    ).toEqual([approved.id, pending.id]);

    const submitted = t.slackApi.mark();
    await t.slack
      .submitView(workspace, member, modal, {
        [CANCEL_REQUEST_ACTION_ID]: approved.id,
      })
      .expect(200);
    const home = await publishedHome(t, workspace, member, submitted);

    expect(noticeOf(home)).toBe('✅ Vacation request canceled.');
    expect(await statusOf(approved)).toBe(VacationRequestStatus.Canceled);
  });

  it('tells the requester too when HR cancels it with Edit Request', async () => {
    const request = await approvedTimeOff();
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
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

    const since = t.slackApi.mark();
    await t.slack
      .submitView(workspace, hr, form, {
        status: VacationRequestStatus.Canceled,
      })
      .expect(200);
    await t.idle();

    const told = `🚫 Time off canceled for *Max Member*\n*Annual leave* · ${formatDateRange(request.start_date, request.end_date)} (5 days, 5 working)\nCanceled by <@${hr.slack_id}>`;
    expect(await statusOf(request)).toBe(VacationRequestStatus.Canceled);
    expect(dmTextsSince(member, since)).toEqual([told]);
    expect(dmTextsSince(manager, since)).toEqual([told]);
    expect(dmTextsSince(recipient, since)).toEqual([told]);
    expect(dmTextsSince(hr, since)).toEqual([]);
  });

  describe('time logged from it', () => {
    let client: Tables<'clients'>;
    let vacations: Tables<'projects'>;

    beforeEach(async () => {
      client = await workspace.addClient({ name: 'Internal' });
      vacations = await workspace.addProject({
        name: 'Vacations',
        client_id: client.id,
      });
      await t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: 'annual_leave',
          project_id: vacations.id,
        })
        .execute();
    });

    const logged = async (request: Tables<'vacation_requests'>) => {
      const user = await t.app
        .get(UsersService)
        .findOneWithValidation({ id: member.id, slackTeamId: workspace.id });
      await t.app.get(TimeOffLoggingService).log(user, request.id);
      expect(await liveEntries()).toHaveLength(5);
    };

    const liveEntries = async () =>
      (await workspace.rows('time_entries'))
        .filter(({ deleted_at }) => deleted_at === null)
        .sort((a, b) => a.work_date.localeCompare(b.work_date));

    const lockInSnapshot = async (entries: Tables<'time_entries'>[]) => {
      const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
      const snapshot = await t.db
        .insertInto('billing_snapshots')
        .values({
          slack_team_id: workspace.id,
          client_id: client.id,
          period_start: entries[0].work_date.slice(0, 10),
          period_end: entries[entries.length - 1].work_date.slice(0, 10),
          currency: 'USD',
          total_minutes: minutes,
          billable_minutes: minutes,
          total_amount: 0,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      await t.db
        .insertInto('billing_snapshot_entries')
        .values(
          entries.map((entry) => ({
            slack_team_id: workspace.id,
            snapshot_id: snapshot.id,
            time_entry_id: entry.id,
            minutes: entry.minutes,
            billable: entry.billable,
          })),
        )
        .execute();
    };

    it('removes it, keeps billed days, and tells the requester what went', async () => {
      const request = await approvedTimeOff();
      await logged(request);
      const billed = (await liveEntries()).slice(0, 2);
      await lockInSnapshot(billed);
      const billedDates = formatDateList(
        billed.map(({ work_date }) => work_date.slice(0, 10)),
      );

      const since = t.slackApi.mark();
      await t.slack
        .submitView(workspace, member, await openCancel(request))
        .expect(200);
      const tab = await publishedHome(t, workspace, member, since);

      expect(noticeOf(tab)).toBe(
        `✅ Vacation request canceled. 2 days stay logged: they are billed (${billedDates}).`,
      );
      expect((await liveEntries()).map(({ id }) => id)).toEqual(
        billed.map(({ id }) => id),
      );
      await t.idle();
      expect(
        t.slackApi
          .postedMessages(workspace.token, member.slack_id, { since })
          .map((message) => sectionTexts(message as unknown as View)[0]),
      ).toEqual([
        `Your annual leave ${formatDateRange(request.start_date, request.end_date)} was canceled: the 24h logged on Vacations were removed. 2 days stay logged: they are billed (${billedDates}).`,
      ]);
    });

    // The workflow approves it, and its time is logged, between the cancel's
    // check and its write: the cancel reads it again under the lock, removes
    // the time and tells of an approved time off canceled.
    it('cleans up after a request approved while the cancel was being checked', async () => {
      const request = await requestVacation(t, workspace, member, workWeek(1));
      await approvalMessageTo(t, workspace, manager);
      const modal = await openCancel(request);
      const requests = t.app.get(VacationRequestsService);
      const checkUpdate = requests.checkUpdate.bind(requests);
      const approveAfterCheck = jest
        .spyOn(requests, 'checkUpdate')
        .mockImplementation(async (...args) => {
          const checked = await checkUpdate(...args);

          await t.db
            .updateTable('vacation_requests')
            .set({ status: VacationRequestStatus.Approved })
            .where('id', '=', request.id)
            .execute();
          await logged(request);

          return checked;
        });

      const since = t.slackApi.mark();
      try {
        await t.slack.submitView(workspace, member, modal).expect(200);
      } finally {
        approveAfterCheck.mockRestore();
      }
      await t.idle();

      expect(await statusOf(request)).toBe(VacationRequestStatus.Canceled);
      expect(await liveEntries()).toEqual([]);
      expect(dmTextsSince(recipient, since)).toHaveLength(1);
    });
  });
});
