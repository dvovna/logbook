import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables } from '@common/types/database.types';
import { formatDateRange } from '@common/utils/date.utils';
import { View } from '@slack/types/dist/views';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { VacationHistoryTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-history-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { workWeek } from './support/dates';
import {
  actOnTab,
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
import { submitVacationRequest } from './support/vacation-flows';

// Where the Time off request form goes once it is sent: it closes, and the
// tab it came from shows the request with a notice.
describe('Time off request form', () => {
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
    manager = await workspace.addUser({ role: UserRole.Manager });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: team.id });
  });

  const send = (form: View, { start, end }: { start: string; end: string }) =>
    t.slack
      .submitView(workspace, member, form, {
        start_date: start,
        end_date: end,
        type_option: VacationType.AnnualLeave,
      })
      .expect(200);

  const pendingRequestOnHome = ({
    start,
    end,
  }: {
    start: string;
    end: string;
  }) => `*Annual leave*\n${formatDateRange(start, end)} (5 days)`;

  it('closes and shows the request on Home, sent from Home', async () => {
    const dates = workWeek(2);
    const form = await openModalFrom(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member),
      HomeTabActionId.OpenVacationModal,
    );

    const since = t.slackApi.mark();
    const response = await send(form, dates);

    expect(response.body).toEqual({ response_action: 'clear' });
    const home = await publishedHome(t, workspace, member, since);
    expect(home.callback_id).toBe(ViewCallbackId.HomeTabView);
    expect(noticeOf(home)).toBe('✅ Vacation request created.');
    expect(sectionTexts(home)).toContain(pendingRequestOnHome(dates));
  });

  it('closes and goes back to Time off with its filters, sent from there', async () => {
    const dates = workWeek(2);
    const timeOff = await actOnTab(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member, [NavigationActionId.TimeOff]),
      VacationHistoryTabViewActionId.FilterRequestsByType,
      VacationType.AnnualLeave,
    );
    const form = await openModalFrom(
      t,
      workspace,
      member,
      timeOff,
      VacationHistoryTabViewActionId.RequestTimeOff,
    );

    const since = t.slackApi.mark();
    const response = await send(form, dates);

    expect(response.body).toEqual({ response_action: 'clear' });
    const tab = await publishedHome(t, workspace, member, since);
    expect(tab.callback_id).toBe(ViewCallbackId.VacationHistoryTabView);
    expect(noticeOf(tab)).toBe('✅ Vacation request created.');
    expect(JSON.parse(tab.private_metadata!)).toEqual({
      filters: { type: VacationType.AnnualLeave },
      page: 1,
    });
    const [request] = await workspace.rows('vacation_requests');
    expect(listItems(tab).map(({ id }) => id)).toEqual([request.id]);
  });

  it('still goes back to Time off after the form showed an error', async () => {
    // As many pending requests as a user may have.
    const pending = await Promise.all(
      [3, 4, 5, 6, 7].map((weeks) =>
        workspace.addVacationRequest(member, {
          start_date: workWeek(weeks).start,
          end_date: workWeek(weeks).end,
          status: VacationRequestStatus.Pending,
        }),
      ),
    );
    const dates = workWeek(2);
    const form = await openModalFrom(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member, [NavigationActionId.TimeOff]),
      VacationHistoryTabViewActionId.RequestTimeOff,
    );

    const refused = await send(form, dates);

    expect(refused.body.response_action).toBe('update');
    expect(modalError(refused.body.view)).toBe(
      'Max opened vacation requests limit reached (5)',
    );

    await t.db
      .updateTable('vacation_requests')
      .set({ status: VacationRequestStatus.Canceled })
      .where('id', '=', pending[0].id)
      .execute();
    const since = t.slackApi.mark();
    const response = await send(refused.body.view, dates);

    expect(response.body).toEqual({ response_action: 'clear' });
    const tab = await publishedHome(t, workspace, member, since);
    expect(tab.callback_id).toBe(ViewCallbackId.VacationHistoryTabView);
    expect(noticeOf(tab)).toBe('✅ Vacation request created.');
  });

  // No tab to go back to: Home lists the request, and the DM about who
  // decides it confirms it where the command was typed.
  it('closes and refreshes Home, sent from /vacations request', async () => {
    const dates = workWeek(2);
    const since = t.slackApi.mark();

    const response = await submitVacationRequest(t, workspace, member, dates);

    expect(response).toEqual({ response_action: 'clear' });
    const home = await publishedHome(t, workspace, member, since);
    expect(home.callback_id).toBe(ViewCallbackId.HomeTabView);
    expect(noticeOf(home)).toBe('✅ Vacation request created.');
    expect(sectionTexts(home)).toContain(pendingRequestOnHome(dates));
    expect(
      t.slackApi
        .postedMessages(workspace.token, member.slack_id)
        .map(({ text }) => text),
    ).toEqual([
      `📨 Your vacation request (${formatDateRange(dates.start, dates.end)}) went to <@${manager.slack_id}> (Manager approval).`,
    ]);
  });
});
