import { writeFileSync } from 'node:fs';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ApproverMessageActionId } from '@modules/slack/approvals/enums/approver-message-action-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { LOG_TIME_OFF_ACTION_ID } from '@modules/slack/tabs/vacation-requests/services/time-off-offer.service';
import { UsersService } from '@modules/users/services/users.service';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { cellKey } from 'src/time-entries/types/timesheet.types';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { buttonText } from './support/tab-readers';
import { workWeek } from './support/dates';
import { approvalMessageTo, requestVacation } from './support/vacation-flows';
import { ISqlCount } from './support/sql-log';

const MY_TIME = [NavigationActionId.MyTime];
// Today is Wednesday 2026-06-17 (TEST_NOW): the week is 15 to 21 June.
const [MON, TUE, WED, THU, FRI] = [
  '2026-06-15',
  '2026-06-16',
  '2026-06-17',
  '2026-06-18',
  '2026-06-19',
];
const LAST_WEEK = '2026-06-08';

// Every statement comes back this much later, so that statements run at once
// and one after another show apart in the timings.
const LATENCY_MS = 5;

// What each action may send at most before its answer: statements, and
// round trips one after another. Where the app runs far from its database
// (the dev bot on a laptop, Supabase in us-east-1), a round trip costs about
// 100 ms, and Slack gives up on an answer after 3 seconds.
const LIMITS: Record<string, ISqlCount> = {
  'open the week form': { statements: 4, roundTrips: 2 },
  'open the day form': { statements: 4, roundTrips: 2 },
  'save a week of 2 projects × 5 days': { statements: 8, roundTrips: 7 },
  'change and clear 2 × 5 cells': { statements: 9, roundTrips: 8 },
  'save the day form': { statements: 8, roundTrips: 7 },
  'add a project to the form': { statements: 1, roundTrips: 1 },
  'show the weekend in the form': { statements: 1, roundTrips: 1 },
  'change the day in the form': { statements: 1, roundTrips: 1 },
  'open My time': { statements: 1, roundTrips: 1 },
  'go to the previous week on My time': { statements: 8, roundTrips: 3 },
  "change a logged vacation's dates": { statements: 15, roundTrips: 10 },
  "change a vacation's comment": { statements: 10, roundTrips: 9 },
  'delete a logged vacation': { statements: 9, roundTrips: 9 },
  'log time off from the offer': { statements: 2, roundTrips: 2 },
  'save the time off settings': { statements: 7, roundTrips: 7 },
};

// What the actions sent, for ROUND_TRIPS_REPORT.
const measured: Record<string, { answer: ISqlCount; all: ISqlCount }> = {};

// How many statements the app sends to Postgres before it answers Slack, for
// the actions people wait on, and how many round trips they take one after
// another. A change that brings round trips back fails here, with the
// statements. `ROUND_TRIPS_REPORT=<file> pnpm test:int round-trips` writes
// what each action sent, before the answer and in all, to the file.
describe('Round trips to the database before the answer', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let member: Tables<'users'>;
  let website: Tables<'projects'>;
  let mobile: Tables<'projects'>;
  let design: Tables<'teams'>;

  beforeAll(async () => {
    t = await createTestApp();
    t.sql.setLatency(LATENCY_MS);
  });

  afterAll(async () => {
    if (process.env.ROUND_TRIPS_REPORT) {
      writeFileSync(process.env.ROUND_TRIPS_REPORT, JSON.stringify(measured));
    }

    await t.close();
  });

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    const manager = await workspace.addUser({ role: UserRole.Manager });
    design = await workspace.addTeam({
      name: 'Design',
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: design.id, name: 'Mia' });
    const acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
    mobile = await workspace.addProject({ name: 'Mobile', client_id: acme.id });
    await workspace.assignToProject(website, { teams: [design] });
    await workspace.assignToProject(mobile, { teams: [design] });
    // Last week's time: the week form offers both projects.
    await workspace.addTimeEntry(member, website, {
      work_date: LAST_WEEK,
      minutes: 60,
    });
    await workspace.addTimeEntry(member, mobile, {
      work_date: LAST_WEEK,
      minutes: 60,
    });
  });

  // Runs `action` (one request to the app) and checks what it sent before
  // the answer against LIMITS[name]. Returns what `action` returned.
  const measure = async <T>(name: string, action: () => Promise<T>) => {
    await t.idle();
    const since = t.sql.mark();

    const result = await action();
    await t.idle();

    const count = t.sql.count(since);
    const limit = LIMITS[name];

    measured[name] = count;

    if (
      count.answer.statements > limit.statements ||
      count.answer.roundTrips > limit.roundTrips
    ) {
      const sent = t.sql
        .statements(since)
        .filter(({ background }) => !background)
        .map(({ text }) => `  ${text.replace(/\s+/g, ' ').slice(0, 140)}`);

      throw new Error(
        `"${name}" sent ${count.answer.statements} statements in ${count.answer.roundTrips} round trips before its answer, more than ${limit.statements} in ${limit.roundTrips}:\n${sent.join('\n')}`,
      );
    }

    return result;
  };

  const myTime = () => openAppHomeTab(t, workspace, member, MY_TIME);

  const openForm = async (
    name: string,
    action = TimeEntriesTabViewActionId.FillWeek,
  ) => {
    const tab = await myTime();

    return measure(name, () =>
      openModalFrom(t, workspace, member, tab, action),
    );
  };

  const actOnForm = (
    name: string,
    form: View,
    actionId: string,
    value?: string,
  ) =>
    measure(name, () =>
      t.slack.actOnView(workspace, member, form, actionId, value).expect(200),
    );

  const submit = (
    name: string,
    form: View,
    values: Record<string, string>,
    user = member,
  ) =>
    measure(name, () =>
      t.slack.submitView(workspace, user, form, values).expect(200),
    );

  it('opens the week form and saves a week, then changes it', async () => {
    const week = await openForm('open the week form');

    const saved = await submit('save a week of 2 projects × 5 days', week, {
      [cellKey(website.id, MON)]: '6',
      [cellKey(website.id, TUE)]: '4',
      [cellKey(website.id, WED)]: '5',
      [cellKey(website.id, THU)]: '1',
      [cellKey(website.id, FRI)]: '2',
      [cellKey(mobile.id, MON)]: '2',
      [cellKey(mobile.id, TUE)]: '4',
      [cellKey(mobile.id, WED)]: '3',
      [cellKey(mobile.id, THU)]: '2',
      [cellKey(mobile.id, FRI)]: '1',
    });

    expect(saved.body).toEqual({ response_action: 'clear' });

    const changed = await submit(
      'change and clear 2 × 5 cells',
      await openModalFrom(
        t,
        workspace,
        member,
        await myTime(),
        TimeEntriesTabViewActionId.FillWeek,
      ),
      {
        [cellKey(website.id, MON)]: '5',
        [cellKey(website.id, TUE)]: '3',
        [cellKey(website.id, WED)]: '',
        [cellKey(website.id, THU)]: '2',
        [cellKey(website.id, FRI)]: '3',
        [cellKey(mobile.id, MON)]: '1',
        [cellKey(mobile.id, TUE)]: '',
        [cellKey(mobile.id, WED)]: '2',
        [cellKey(mobile.id, THU)]: '3',
        [cellKey(mobile.id, FRI)]: '4',
      },
    );

    expect(changed.body).toEqual({ response_action: 'clear' });
    expect(
      (await workspace.rows('time_entries')).filter(
        ({ deleted_at, work_date }) => !deleted_at && work_date >= MON,
      ),
    ).toHaveLength(8);
  });

  it('adds a project to the week form and shows the weekend', async () => {
    const internal = await workspace.addProject({ name: 'Internal' });
    await workspace.assignToProject(internal, { teams: [design] });
    const form = await openForm('open the week form');
    const since = t.slackApi.mark();

    await actOnForm(
      'add a project to the form',
      form,
      TimesheetFormActionId.AddProject,
      internal.id,
    );
    await actOnForm(
      'show the weekend in the form',
      t.slackApi.updatedModal(workspace.token, { since }),
      TimesheetFormActionId.ShowWeekend,
      'show',
    );

    expect(t.slackApi.callsWith(workspace.token, 'views.update')).toHaveLength(
      2,
    );
  });

  it('opens the day form, changes its day and saves it', async () => {
    const form = await openForm(
      'open the day form',
      TimeEntriesTabViewActionId.FillDay,
    );

    await actOnForm(
      'change the day in the form',
      form,
      TimesheetFormActionId.Day,
      THU,
    );

    const saved = await submit('save the day form', form, {
      [cellKey(website.id, WED)]: '5',
      [cellKey(mobile.id, WED)]: '3',
      [TimesheetFormActionId.Comment]: 'Sprint review',
    });

    expect(saved.body).toEqual({ response_action: 'clear' });
  });

  it('opens My time and goes to the previous week', async () => {
    const home = await openAppHomeTab(t, workspace, member);

    await measure('open My time', () =>
      t.slack
        .actOnView(workspace, member, home, NavigationActionId.MyTime)
        .expect(200),
    );
    const tab = await myTime();

    await measure('go to the previous week on My time', () =>
      t.slack
        .actOnView(
          workspace,
          member,
          tab,
          TimeEntriesTabViewActionId.PreviousWeek,
        )
        .expect(200),
    );
  });

  describe('time off', () => {
    let admin: Tables<'users'>;
    let hr: Tables<'users'>;
    let requester: Tables<'users'>;
    let vacations: Tables<'projects'>;

    beforeEach(async () => {
      admin = await workspace.addUser({ role: UserRole.Admin });
      // A team with a policy and a holiday, as most are.
      const policy = await workspace.addVacationPolicy({ vacation_days: 25 });
      await t.db
        .updateTable('teams')
        .set({ vacation_policy_id: policy.id })
        .where('id', '=', design.id)
        .execute();
      await t.db
        .insertInto('holidays')
        .values({
          slack_team_id: workspace.id,
          vacation_policy_id: policy.id,
          name: 'Founders Day',
          date: '2026-06-24',
          year: 2026,
          is_company_custom: true,
          created_by: admin.id,
        })
        .execute();
      hr = await workspace.addUser({ role: UserRole.HR });
      requester = await workspace.addUser({ team_id: design.id });
      vacations = await workspace.addProject({ name: 'Vacations' });
      await t.db
        .insertInto('time_off_projects')
        .values({
          slack_team_id: workspace.id,
          vacation_type: VacationType.AnnualLeave,
          project_id: vacations.id,
        })
        .execute();
    });

    // This week's annual leave of the requester, logged as time.
    const loggedVacation = async () => {
      const request = await workspace.addVacationRequest(requester, {
        start_date: MON,
        end_date: FRI,
        days: 5,
        working_days: 5,
      });
      const user = await t.app
        .get(UsersService)
        .findOneWithValidation({ id: requester.id, slackTeamId: workspace.id });
      await t.app.get(TimeOffLoggingService).log(user, request.id);

      return request;
    };

    // The Edit or Delete form of `request` from All requests.
    const requestForm = async (
      user: Tables<'users'>,
      request: Tables<'vacation_requests'>,
      action: VacationRequestsTabViewActionId,
    ) =>
      openModalFrom(
        t,
        workspace,
        user,
        await openAppHomeTab(t, workspace, user, [
          NavigationActionId.TimeOff,
          NavigationActionId.AllRequests,
        ]),
        VacationRequestsTabViewActionId.ManageRequestMenu,
        `${action}:${request.id}`,
      );

    it("changes a logged vacation's dates, and its comment", async () => {
      const request = await loggedVacation();

      await submit(
        "change a logged vacation's dates",
        await requestForm(
          hr,
          request,
          VacationRequestsTabViewActionId.EditRequest,
        ),
        { start_date: '2026-06-22', end_date: '2026-06-26' },
        hr,
      );
      await submit(
        "change a vacation's comment",
        await requestForm(
          hr,
          request,
          VacationRequestsTabViewActionId.EditRequest,
        ),
        { comment: 'Family trip' },
        hr,
      );

      expect(
        await workspace.row('vacation_requests', request.id),
      ).toMatchObject({
        start_date: '2026-06-22',
        working_days: 4,
        user_comment: 'Family trip',
      });
    });

    it('deletes a logged vacation', async () => {
      const request = await loggedVacation();

      await submit(
        'delete a logged vacation',
        await requestForm(
          admin,
          request,
          VacationRequestsTabViewActionId.DeleteRequest,
        ),
        {},
        admin,
      );

      expect(await workspace.rows('vacation_requests')).toEqual([]);
    });

    it('logs time off from the offer', async () => {
      const manager = (await workspace.rows('users')).find(
        ({ role }) => role === UserRole.Manager,
      )!;
      await requestVacation(t, workspace, requester, {
        ...workWeek(2),
        type: VacationType.AnnualLeave,
      });
      await t.slack
        .actOnMessage(
          workspace,
          manager,
          await approvalMessageTo(t, workspace, manager),
          ApproverMessageActionId.Approve,
        )
        .expect(200);
      await t.idle();
      const [offer] = t.slackApi
        .postedMessages(workspace.token, requester.slack_id)
        .filter((message) =>
          buttonText(message as unknown as View, LOG_TIME_OFF_ACTION_ID),
        );

      await measure('log time off from the offer', () =>
        t.slack
          .actOnMessage(workspace, requester, offer, LOG_TIME_OFF_ACTION_ID)
          .expect(200),
      );
    });

    it('saves the time off settings', async () => {
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, [
          NavigationActionId.Projects,
        ]),
        ProjectsTabViewActionId.TimeOffSettings,
      );

      const saved = await submit(
        'save the time off settings',
        form,
        { hours: '7.5', annual_leave: vacations.id },
        admin,
      );

      expect(saved.body).toEqual({ response_action: 'clear' });
    });
  });
});
