import { Logger } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { View } from '@slack/types/dist/views';
import { HomeTabActionId } from '@modules/slack/tabs/home/views/home-tab.view';
import { TimesheetFormActionId } from '@modules/slack/tabs/time-tracking/enums/timesheet-form-action-id.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { cellKey } from 'src/time-entries/utils/timesheet-cell-key';
import { COMMENT_BLOCK_ID } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actionIdsOf,
  buttonText,
  listItems,
  modalError,
  noticeOf,
  sectionTexts,
  tableRows,
  timesheetFormRows,
  timesheetStatusOf,
} from './support/tab-readers';
import { travelTo } from './support/clock';
import { acknowledged } from './support/slack-test-client';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

const MY_TIME = [NavigationActionId.MyTime];
const TIME_LOGS = [NavigationActionId.Reports, NavigationActionId.TimeLogs];

// Today is Wednesday 2026-06-17 (TEST_NOW): the week is 15 to 21 June.
describe('The week on My time', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;
  let website: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({ role: UserRole.Manager });
    const design = await workspace.addTeam({
      name: 'Design',
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: design.id, name: 'Mia' });
    const acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
    await workspace.assignToProject(website, { teams: [design] });
  });

  const entry = (
    work_date: string,
    fields: Partial<Tables<'time_entries'>> = {},
  ) =>
    workspace.addTimeEntry(member, website, {
      work_date,
      minutes: 60,
      ...fields,
    });

  const openMyTime = () => openAppHomeTab(t, workspace, member, MY_TIME);

  const act = (view: Awaited<ReturnType<typeof openMyTime>>, id: string) =>
    actOnTab(t, workspace, member, view, id, undefined);

  const dates = (view: Awaited<ReturnType<typeof openMyTime>>) =>
    listItems(view).map(({ fields }) => fields.Description);

  it("shows the week's projects by day with totals and status", async () => {
    await entry('2026-06-15', { minutes: 120 });
    await entry('2026-06-17', {
      minutes: 90,
      status: TimeEntryStatus.Submitted,
    });

    const myTime = await openMyTime();

    expect(tableRows(myTime)).toEqual([
      ['Project', 'Mon 15', 'Tue 16', 'Wed 17', 'Thu 18', 'Fri 19', 'Total'],
      ['Website · Acme', '2h', '–', '1h 30m', '–', '–', '3h 30m'],
      ['Total', '2h', '–', '1h 30m', '–', '–', '3h 30m'],
    ]);
    expect(timesheetStatusOf(myTime)).toBe(
      '🕒 Week of 15 Jun · 3h 30m · 📝 1 draft · 📤 1 submitted',
    );
  });

  it("lists the shown week's entries under the table", async () => {
    await entry('2026-06-17', { description: 'This week' });
    await entry('2026-06-10', { description: 'Last week' });

    const myTime = await openMyTime();
    expect(dates(myTime)).toEqual(['This week']);

    const previous = await act(myTime, TimeEntriesTabViewActionId.PreviousWeek);
    expect(dates(previous)).toEqual(['Last week']);
  });

  it('adds Saturday and Sunday when they hold time', async () => {
    await entry('2026-06-17');
    expect(tableRows(await openMyTime())[0]).not.toContain('Sun 21');

    await entry('2026-06-21');

    expect(tableRows(await openMyTime())[0]).toEqual([
      'Project',
      'Mon 15',
      'Tue 16',
      'Wed 17',
      'Thu 18',
      'Fri 19',
      'Sun 21',
      'Total',
    ]);
  });

  it('goes to the previous and next week', async () => {
    await entry('2026-06-10');
    await entry('2026-06-16');
    const previous = await act(
      await openMyTime(),
      TimeEntriesTabViewActionId.PreviousWeek,
    );

    expect(tableRows(previous)[0].slice(0, 2)).toEqual(['Project', 'Mon 8']);
    expect(timesheetStatusOf(previous)).toContain('Week of 8 Jun');

    const back = await act(previous, TimeEntriesTabViewActionId.NextWeek);

    expect(tableRows(back)[0].slice(0, 2)).toEqual(['Project', 'Mon 15']);
  });

  it('points to the drafts and rejected entries of earlier weeks', async () => {
    await entry('2026-06-10', { description: 'Last week' });
    await entry('2026-06-03', {
      status: TimeEntryStatus.Rejected,
      description: 'Rejected',
    });
    // Neither time sent for approval nor this week's draft counts.
    await entry('2026-06-02', {
      status: TimeEntryStatus.Submitted,
      description: 'Sent',
    });
    await entry('2026-06-16', { description: 'This week' });

    const myTime = await openMyTime();

    expect(sectionTexts(myTime)).toContain(
      '📝 2 open entries in earlier weeks',
    );
    expect(buttonText(myTime, TimeEntriesTabViewActionId.EarlierOpenWeek)).toBe(
      'Go to week of 1 Jun',
    );

    const oldest = await act(
      myTime,
      TimeEntriesTabViewActionId.EarlierOpenWeek,
    );

    expect(timesheetStatusOf(oldest)).toBe(
      '🕒 Week of 1 Jun · 2h · 📤 1 submitted · ❌ 1 rejected',
    );
    expect(dates(oldest)).toEqual(['Rejected', 'Sent']);
    // Nothing open before that week.
    expect(actionIdsOf(oldest)).not.toContain(
      TimeEntriesTabViewActionId.EarlierOpenWeek,
    );
  });

  it('shows a week across the new year', async () => {
    travelTo('2027-01-01');
    await entry('2027-01-01');

    expect(tableRows(await openMyTime())[0]).toEqual([
      'Project',
      'Mon 28',
      'Tue 29',
      'Wed 30',
      'Thu 31',
      'Fri 1',
      'Total',
    ]);
  });

  it("submits only the shown week's drafts and rejected entries", async () => {
    const lastWeek = await entry('2026-06-10');
    const draft = await entry('2026-06-16');
    const rejected = await entry('2026-06-17', {
      status: TimeEntryStatus.Rejected,
    });
    const approved = await entry('2026-06-18', {
      status: TimeEntryStatus.Approved,
    });
    const since = t.slackApi.mark();
    const myTime = await openMyTime();

    expect(buttonText(myTime, TimeEntriesTabViewActionId.SubmitWeek)).toBe(
      '📤 Submit week (2)',
    );

    const updated = await act(myTime, TimeEntriesTabViewActionId.SubmitWeek);
    await t.idle();

    const statusOf = async (e: Tables<'time_entries'>) =>
      (await workspace.row('time_entries', e.id)).status;

    expect(await statusOf(lastWeek)).toBe(TimeEntryStatus.Draft);
    expect(await statusOf(draft)).toBe(TimeEntryStatus.Submitted);
    expect(await statusOf(rejected)).toBe(TimeEntryStatus.Submitted);
    expect(await statusOf(approved)).toBe(TimeEntryStatus.Approved);
    expect(actionIdsOf(updated)).not.toContain(
      TimeEntriesTabViewActionId.SubmitWeek,
    );
    expect(
      t.slackApi
        .postedMessages(workspace.token, manager.slack_id, { since })
        .map(({ text }) => text),
    ).toEqual([expect.stringContaining('submitted *2 time entries* (2h)')]);
  });

  it('keeps the project filter and leaves the dates out', async () => {
    const internal = await workspace.addProject({ name: 'Internal' });
    await entry('2026-06-17', { description: 'Site work' });
    await workspace.addTimeEntry(member, internal, {
      work_date: '2026-06-16',
      minutes: 30,
      description: 'Planning',
    });

    const myTime = await openMyTime();
    const ids = actionIdsOf(myTime);

    expect(ids).toContain(TimeEntriesTabViewActionId.FilterByProject);
    expect(ids).not.toContain(TimeEntriesTabViewActionId.FilterByFromDate);
    expect(ids).not.toContain(TimeEntriesTabViewActionId.FilterByToDate);
    expect(dates(myTime)).toEqual(['Site work', 'Planning']);

    const filtered = await actOnTab(
      t,
      workspace,
      member,
      myTime,
      TimeEntriesTabViewActionId.FilterByProject,
      website.id,
    );

    // The list narrows; the table is still the whole week.
    expect(dates(filtered)).toEqual(['Site work']);
    expect(tableRows(filtered)).toHaveLength(4);
  });

  it('leaves Time logs with its dates and without a table', async () => {
    const admin = await workspace.addUser({ role: UserRole.Admin });
    await entry('2026-06-17');

    const timeLogs = await openAppHomeTab(t, workspace, admin, TIME_LOGS);

    expect(actionIdsOf(timeLogs)).toEqual(
      expect.arrayContaining([
        TimeEntriesTabViewActionId.FilterByFromDate,
        TimeEntriesTabViewActionId.FilterByToDate,
      ]),
    );
    expect(tableRows(timeLogs)).toEqual([]);
    expect(timesheetStatusOf(timeLogs)).toBeUndefined();
  });
});

// Today is Wednesday 2026-06-17 (TEST_NOW): the week is 15 to 21 June.
describe('Fill in the week', () => {
  const [MON, TUE, WED, THU, FRI, SAT] = [
    '2026-06-15',
    '2026-06-16',
    '2026-06-17',
    '2026-06-18',
    '2026-06-19',
    '2026-06-20',
  ];
  const LAST_WEEK = '2026-06-08';
  const EMPTY_WEEK = ['Mon 15 []', 'Tue 16 []', 'Wed 17 []', 'Thu 18 []'];

  let t: ITestApp;
  let workspace: TestWorkspace;
  let manager: Tables<'users'>;
  let member: Tables<'users'>;
  let design: Tables<'teams'>;
  let acme: Tables<'clients'>;
  let website: Tables<'projects'>;
  let mobile: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    manager = await workspace.addUser({ role: UserRole.Manager });
    design = await workspace.addTeam({
      name: 'Design',
      manager_approvers: [manager.slack_id],
    });
    member = await workspace.addUser({ team_id: design.id, name: 'Mia' });
    acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
    mobile = await workspace.addProject({ name: 'Mobile', client_id: acme.id });
    await workspace.assignToProject(website, { teams: [design] });
    await workspace.assignToProject(mobile, { teams: [design] });
  });

  const entry = (
    project: Tables<'projects'>,
    work_date: string,
    fields: Partial<Tables<'time_entries'>> = {},
    user = member,
  ) =>
    workspace.addTimeEntry(user, project, {
      work_date,
      minutes: 60,
      ...fields,
    });

  const openForm = async (user = member) =>
    openModalFrom(
      t,
      workspace,
      user,
      await openAppHomeTab(t, workspace, user, MY_TIME),
      TimeEntriesTabViewActionId.FillWeek,
    );

  // Submits the form; the answer's body is Slack's response_action.
  const submit = (
    form: View,
    values: Record<string, string | string[] | undefined> = {},
    user = member,
    forgedState: Record<string, Record<string, unknown>> = {},
  ) =>
    t.slack.submitView(workspace, user, form, values, forgedState).expect(200);

  // A value typed into a cell the form doesn't have, as a client could send it.
  const forgedCell = (key: string, value: string) => ({
    [key]: { [key]: { type: 'plain_text_input', value } },
  });

  // Chooses `value` in the form's element `actionId`; returns the form as the
  // app updated it.
  const actOnForm = async (form: View, actionId: string, value?: string) => {
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, member, form, actionId, value)
      .expect(200);
    await t.idle();

    return t.slackApi.updatedModal(workspace.token, { since });
  };

  // The user's entries that aren't deleted: 'Website 2026-06-15 60 draft'.
  const entriesOf = async (user = member) => {
    const names = new Map(
      (await workspace.rows('projects')).map(({ id, name }) => [id, name]),
    );

    return (await workspace.rows('time_entries'))
      .filter((row) => row.user_id === user.id && !row.deleted_at)
      .map(
        (row) =>
          `${names.get(row.project_id)} ${row.work_date} ${row.minutes} ${row.status}`,
      )
      .sort();
  };

  const lockInSnapshot = async (timeEntry: Tables<'time_entries'>) => {
    const snapshot = await t.db
      .insertInto('billing_snapshots')
      .values({
        slack_team_id: workspace.id,
        client_id: acme.id,
        period_start: MON,
        period_end: FRI,
        currency: 'USD',
        total_minutes: timeEntry.minutes,
        billable_minutes: timeEntry.minutes,
        total_amount: 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await t.db
      .insertInto('billing_snapshot_entries')
      .values({
        slack_team_id: workspace.id,
        snapshot_id: snapshot.id,
        time_entry_id: timeEntry.id,
        minutes: timeEntry.minutes,
        billable: true,
      })
      .execute();
  };

  it('fills a week at once', async () => {
    await entry(website, LAST_WEEK);
    await entry(mobile, '2026-06-10');
    const form = await openForm();

    expect(timesheetFormRows(form)).toEqual([
      { project: 'Mobile · Acme', cells: [...EMPTY_WEEK, 'Fri 19 []'] },
      { project: 'Website · Acme', cells: [...EMPTY_WEEK, 'Fri 19 []'] },
    ]);

    const since = t.slackApi.mark();
    const answer = await submit(form, {
      [cellKey(website.id, MON)]: '6',
      [cellKey(website.id, TUE)]: '4',
      [cellKey(website.id, WED)]: '5',
      [cellKey(website.id, THU)]: '',
      [cellKey(website.id, FRI)]: '',
      [cellKey(mobile.id, MON)]: '2',
      [cellKey(mobile.id, TUE)]: '4',
      [cellKey(mobile.id, WED)]: '3',
      [cellKey(mobile.id, THU)]: '2',
      [cellKey(mobile.id, FRI)]: '',
    });

    expect(answer.body).toEqual({ response_action: 'clear' });

    const myTime = await publishedHome(t, workspace, member, since);

    expect(noticeOf(myTime)).toBe('✅ Saved. Week of 15 Jun: 26h.');
    expect(tableRows(myTime)).toEqual([
      ['Project', 'Mon 15', 'Tue 16', 'Wed 17', 'Thu 18', 'Fri 19', 'Total'],
      ['Mobile · Acme', '2h', '4h', '3h', '2h', '–', '11h'],
      ['Website · Acme', '6h', '4h', '5h', '–', '–', '15h'],
      ['Total', '8h', '8h', '8h', '2h', '–', '26h'],
    ]);
    expect(await entriesOf()).toEqual([
      'Mobile 2026-06-10 60 draft',
      'Mobile 2026-06-15 120 draft',
      'Mobile 2026-06-16 240 draft',
      'Mobile 2026-06-17 180 draft',
      'Mobile 2026-06-18 120 draft',
      'Website 2026-06-08 60 draft',
      'Website 2026-06-15 360 draft',
      'Website 2026-06-16 240 draft',
      'Website 2026-06-17 300 draft',
    ]);
  });

  it('changes and removes a draft and a rejected entry by its cell', async () => {
    const removed = await entry(website, MON);
    const rejected = await entry(website, TUE, {
      minutes: 120,
      status: TimeEntryStatus.Rejected,
      rejection_reason: 'Too much',
    });
    const zeroed = await entry(mobile, WED);
    const kept = await entry(mobile, THU, { minutes: 30 });
    const form = await openForm();

    expect(timesheetFormRows(form)).toEqual([
      {
        project: 'Mobile · Acme',
        cells: [
          'Mon 15 []',
          'Tue 16 []',
          'Wed 17 [1]',
          'Thu 18 [0.5]',
          'Fri 19 []',
        ],
      },
      {
        project: 'Website · Acme',
        cells: [
          'Mon 15 [1]',
          'Tue 16 [2]',
          'Wed 17 []',
          'Thu 18 []',
          'Fri 19 []',
        ],
      },
    ]);

    await submit(form, {
      [cellKey(website.id, MON)]: '',
      [cellKey(website.id, TUE)]: '1.5',
      [cellKey(mobile.id, WED)]: '0',
    });

    const row = (id: string) => workspace.row('time_entries', id);

    expect((await row(removed.id)).deleted_at).not.toBeNull();
    expect((await row(zeroed.id)).deleted_at).not.toBeNull();
    expect(await row(rejected.id)).toMatchObject({
      minutes: 90,
      status: TimeEntryStatus.Draft,
      rejection_reason: null,
      deleted_at: null,
    });
    expect(await row(kept.id)).toEqual(kept);
  });

  it('shows locked cells as text with the reason', async () => {
    await entry(website, WED, {
      minutes: 120,
      status: TimeEntryStatus.Submitted,
    });
    await entry(website, THU, { status: TimeEntryStatus.Approved });
    await lockInSnapshot(
      await entry(mobile, MON, { status: TimeEntryStatus.Approved }),
    );
    await entry(mobile, TUE);
    await entry(mobile, TUE, { minutes: 30 });

    expect(timesheetFormRows(await openForm())).toEqual([
      {
        project: 'Mobile · Acme',
        cells: [
          'Mon 15 · 1h · billed',
          'Tue 16 · 1h 30m · 2 entries',
          'Wed 17 []',
          'Thu 18 []',
          'Fri 19 []',
        ],
      },
      {
        project: 'Website · Acme',
        cells: [
          'Mon 15 []',
          'Tue 16 []',
          'Wed 17 · 2h · submitted',
          'Thu 18 · 1h · approved',
          'Fri 19 []',
        ],
      },
    ]);
  });

  it('refuses a forged input for a locked cell', async () => {
    const submitted = await entry(website, WED, {
      status: TimeEntryStatus.Submitted,
    });
    const form = await openForm();

    const answer = await submit(
      form,
      {},
      member,
      forgedCell(cellKey(website.id, WED), '5'),
    );

    expect(modalError(answer.body.view)).toBe(
      'Submitted time entries cannot be edited',
    );
    expect(await workspace.row('time_entries', submitted.id)).toEqual(
      submitted,
    );
    expect(await entriesOf()).toEqual(['Website 2026-06-17 60 submitted']);
  });

  it('answers odd hours at their cell', async () => {
    await entry(website, LAST_WEEK);
    const form = await openForm();
    const at = (date: string) => cellKey(website.id, date);
    const notANumber = 'Hours must be a number between 0 and 24';

    const answer = await submit(form, {
      [at(MON)]: '-1',
      [at(TUE)]: 'abc',
      [at(WED)]: '25',
      [at(THU)]: '0.1',
      [at(FRI)]: '1,5',
    });

    expect(answer.body).toEqual({
      response_action: 'errors',
      errors: {
        [at(MON)]: notANumber,
        [at(TUE)]: notANumber,
        [at(WED)]: notANumber,
        [at(THU)]: 'Use 15-minute steps: 0.25, 0.5, 0.75, 1…',
      },
    });
    expect(await entriesOf()).toEqual(['Website 2026-06-08 60 draft']);

    const saved = await submit(form, { [at(FRI)]: '1,5' });

    expect(saved.body).toEqual({ response_action: 'clear' });
    expect(await entriesOf()).toEqual([
      'Website 2026-06-08 60 draft',
      'Website 2026-06-19 90 draft',
    ]);
  });

  it('refuses a cell that changed after the form opened', async () => {
    const draft = await entry(website, WED);
    const form = await openForm();

    await actOnTab(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member),
      HomeTabActionId.SubmitTimeEntries,
    );
    const submitted = await workspace.row('time_entries', draft.id);
    expect(submitted.status).toBe(TimeEntryStatus.Submitted);

    const key = cellKey(website.id, WED);
    const changed = await submit(form, { [key]: '2' });

    expect(changed.body).toEqual({
      response_action: 'errors',
      errors: { [key]: 'Submitted time entries cannot be edited' },
    });
    expect(await workspace.row('time_entries', draft.id)).toEqual(submitted);

    // Left as the form showed it: nothing to save there.
    const asShown = await submit(form);

    expect(asShown.body).toEqual({ response_action: 'clear' });
    expect(await workspace.row('time_entries', draft.id)).toEqual(submitted);
  });

  it('refuses a cell someone logged time in after the form opened', async () => {
    await entry(website, LAST_WEEK);
    const form = await openForm();
    const key = cellKey(website.id, WED);

    expect(timesheetFormRows(form)[0].cells[2]).toBe('Wed 17 []');

    // Then 2h on Wednesday with /log.
    const since = t.slackApi.mark();
    await t.slack
      .command('/api/slack/log', workspace, member)
      .expect(acknowledged);
    await t.idle();
    await t.slack
      .submitView(
        workspace,
        member,
        t.slackApi.openedModal(workspace.token, { since }),
        { projectId: website.id, workDate: WED, hours: '2' },
      )
      .expect(200);
    const [logged] = (await workspace.rows('time_entries')).filter(
      (row) => row.work_date === WED,
    );
    expect(logged.minutes).toBe(120);

    const answer = await submit(form, { [key]: '3' });

    expect(answer.body).toEqual({
      response_action: 'errors',
      errors: {
        [key]: 'This time changed after the form opened: open the form again.',
      },
    });
    expect(await workspace.row('time_entries', logged.id)).toEqual(logged);
    expect(await entriesOf()).toEqual([
      'Website 2026-06-08 60 draft',
      'Website 2026-06-17 120 draft',
    ]);
  });

  it('adds a project and shows the weekend', async () => {
    const secret = await workspace.addProject({
      name: 'Secret',
      client_id: acme.id,
    });
    await entry(website, LAST_WEEK);
    const form = await openForm();

    expect(timesheetFormRows(form).map(({ project }) => project)).toEqual([
      'Website · Acme',
    ]);

    const added = await actOnForm(
      form,
      TimesheetFormActionId.AddProject,
      mobile.id,
    );

    expect(timesheetFormRows(added)).toEqual([
      { project: 'Mobile · Acme', cells: [...EMPTY_WEEK, 'Fri 19 []'] },
      { project: 'Website · Acme', cells: [...EMPTY_WEEK, 'Fri 19 []'] },
    ]);

    const weekend = await actOnForm(
      added,
      TimesheetFormActionId.ShowWeekend,
      'show',
    );

    expect(timesheetFormRows(weekend)[0].cells).toEqual([
      ...EMPTY_WEEK,
      'Fri 19 []',
      'Sat 20 []',
      'Sun 21 []',
    ]);

    // A project the member may not log on, as a client could send it.
    const since = t.slackApi.mark();
    await t.slack
      .interaction({
        type: 'block_actions',
        team: { id: workspace.slackId },
        user: { id: member.slack_id },
        trigger_id: 'trigger-forged',
        container: { type: 'view' },
        view: { team_id: workspace.slackId, ...weekend },
        actions: [
          {
            type: 'static_select',
            action_id: TimesheetFormActionId.AddProject,
            block_id: 'forged',
            action_ts: '1',
            selected_option: {
              text: { type: 'plain_text', text: 'Secret' },
              value: secret.id,
            },
          },
        ],
      })
      .expect(200);
    await t.idle();

    expect(
      t.slackApi.callsWith(workspace.token, 'views.update', { since }),
    ).toEqual([]);

    // Saturday holds time: it shows without the checkbox.
    await entry(website, SAT, { minutes: 120 });

    expect(timesheetFormRows(await openForm())).toEqual([
      {
        project: 'Website · Acme',
        cells: [...EMPTY_WEEK, 'Fri 19 []', 'Sat 20 [2]'],
      },
    ]);

    // Ten rows: no more to add, and the whole week stays within Slack's
    // 100 blocks of a modal.
    for (let i = 1; i <= 8; i++) {
      const project = await workspace.addProject({
        name: `Project ${i}`,
        client_id: acme.id,
      });
      await workspace.assignToProject(project, { teams: [design] });
      await entry(project, LAST_WEEK);
    }

    const nine = await openForm();

    expect(timesheetFormRows(nine)).toHaveLength(9);
    expect(actionIdsOf(nine)).toContain(TimesheetFormActionId.AddProject);

    const ten = await actOnForm(
      nine,
      TimesheetFormActionId.AddProject,
      mobile.id,
    );

    expect(timesheetFormRows(ten)).toHaveLength(10);
    expect(actionIdsOf(ten)).not.toContain(TimesheetFormActionId.AddProject);

    const full = await actOnForm(
      ten,
      TimesheetFormActionId.ShowWeekend,
      'show',
    );

    expect(timesheetFormRows(full).flatMap(({ cells }) => cells)).toHaveLength(
      70,
    );
  });

  it('leaves a rebuild out when a later click changed the form first', async () => {
    const internal = await workspace.addProject({ name: 'Internal' });
    await workspace.assignToProject(internal, { teams: [design] });
    await entry(website, LAST_WEEK);
    const form = await openForm();
    const added = await actOnForm(
      form,
      TimesheetFormActionId.AddProject,
      mobile.id,
    );
    const errors = jest.spyOn(Logger.prototype, 'error');
    const since = t.slackApi.mark();

    try {
      // A second click in the form as it was before the first one's rebuild.
      await t.slack
        .actOnView(
          workspace,
          member,
          form,
          TimesheetFormActionId.AddProject,
          internal.id,
        )
        .expect(200);
      await t.idle();

      // Slack refused it (hash_conflict): the form stays as the first click
      // made it, and nothing is logged as an error.
      expect(
        t.slackApi.callsWith(workspace.token, 'views.update', { since }),
      ).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }

    expect(timesheetFormRows(added).map(({ project }) => project)).toEqual([
      'Mobile · Acme',
      'Website · Acme',
    ]);
  });

  it('keeps old and archived projects read-only', async () => {
    const old = await workspace.addProject({ name: 'Old', client_id: acme.id });
    await t.db
      .updateTable('projects')
      .set({ archived_at: new Date().toISOString() })
      .where('id', '=', website.id)
      .execute();
    await entry(website, WED, { minutes: 120 });
    await entry(old, TUE);
    const form = await openForm();

    expect(timesheetFormRows(form)).toEqual([
      { project: 'Old · Acme', cells: ['Tue 16 · 1h · closed for logging'] },
      {
        project: 'Website · Acme',
        cells: ['Wed 17 · 2h · closed for logging'],
      },
    ]);

    const answer = await submit(
      form,
      {},
      member,
      forgedCell(cellKey(website.id, MON), '3'),
    );

    expect(modalError(answer.body.view)).toBe('This project is not available.');
    expect(await entriesOf()).toEqual([
      'Old 2026-06-16 60 draft',
      'Website 2026-06-17 120 draft',
    ]);
  });

  it('leaves out older projects the member may no longer log on', async () => {
    const retired = await workspace.addProject({
      name: 'Retired',
      client_id: acme.id,
    });
    await workspace.assignToProject(retired, { teams: [design] });
    await t.db
      .updateTable('projects')
      .set({ archived_at: new Date().toISOString() })
      .where('id', '=', retired.id)
      .execute();
    // Never assigned to the member's team.
    const elsewhere = await workspace.addProject({
      name: 'Elsewhere',
      client_id: acme.id,
    });
    await entry(retired, LAST_WEEK);
    await entry(elsewhere, LAST_WEEK);
    await entry(website, LAST_WEEK);

    expect(timesheetFormRows(await openForm())).toEqual([
      { project: 'Website · Acme', cells: [...EMPTY_WEEK, 'Fri 19 []'] },
    ]);
  });

  it('submits the week too when asked', async () => {
    await entry(website, LAST_WEEK);
    await entry(website, TUE);
    const form = await openForm();
    const since = t.slackApi.mark();

    await submit(form, {
      [cellKey(website.id, MON)]: '2',
      [TimesheetFormActionId.SubmitWeek]: ['submit'],
    });
    await t.idle();

    expect(await entriesOf()).toEqual([
      'Website 2026-06-08 60 draft',
      'Website 2026-06-15 120 submitted',
      'Website 2026-06-16 60 submitted',
    ]);
    expect(
      t.slackApi
        .postedMessages(workspace.token, manager.slack_id, { since })
        .map(({ text }) => text),
    ).toEqual([expect.stringContaining('submitted *2 time entries* (3h)')]);
  });

  it("is only for one's own time", async () => {
    const hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana' });
    await entry(website, LAST_WEEK, {}, hr);
    const members = await entry(website, WED, { minutes: 120 });
    const form = await openForm(hr);

    expect(timesheetFormRows(form)).toEqual([
      { project: 'Website · Acme', cells: [...EMPTY_WEEK, 'Fri 19 []'] },
    ]);

    const since = t.slackApi.mark();
    await submit(form, { [cellKey(website.id, WED)]: '3' }, hr);

    expect(await entriesOf(hr)).toEqual([
      'Website 2026-06-08 60 draft',
      'Website 2026-06-17 180 draft',
    ]);
    expect(await workspace.row('time_entries', members.id)).toEqual(members);
    expect(noticeOf(await publishedHome(t, workspace, hr, since))).toBe(
      '✅ Saved. Week of 15 Jun: 3h.',
    );
  });
});

describe('Fill in today', () => {
  const [WED, THU] = ['2026-06-17', '2026-06-18'];
  const LAST_WEEK = '2026-06-08';

  let t: ITestApp;
  let workspace: TestWorkspace;
  let member: Tables<'users'>;
  let website: Tables<'projects'>;
  let mobile: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    const design = await workspace.addTeam({ name: 'Design' });
    member = await workspace.addUser({ team_id: design.id, name: 'Mia' });
    const acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
    mobile = await workspace.addProject({ name: 'Mobile', client_id: acme.id });
    await workspace.assignToProject(website, { teams: [design] });
    await workspace.assignToProject(mobile, { teams: [design] });
  });

  const entry = (
    project: Tables<'projects'>,
    work_date: string,
    fields: Partial<Tables<'time_entries'>> = {},
  ) =>
    workspace.addTimeEntry(member, project, {
      work_date,
      minutes: 60,
      ...fields,
    });

  const openForm = async (action = TimeEntriesTabViewActionId.FillDay) =>
    openModalFrom(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member, MY_TIME),
      action,
    );

  const submit = (
    form: View,
    values: Record<string, string | undefined> = {},
  ) => t.slack.submitView(workspace, member, form, values).expect(200);

  const actOnForm = async (form: View, actionId: string, value?: string) => {
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, member, form, actionId, value)
      .expect(200);
    await t.idle();

    return t.slackApi.updatedModal(workspace.token, { since });
  };

  const entriesOf = async () =>
    (await workspace.rows('time_entries'))
      .filter((row) => !row.deleted_at)
      .map((row) =>
        `${row.project_id === website.id ? 'Website' : 'Mobile'} ${row.work_date} ${row.minutes} ${row.status} ${row.description ?? ''}`.trim(),
      )
      .sort();

  it('fills a day at once', async () => {
    await entry(website, LAST_WEEK);
    await entry(mobile, LAST_WEEK);
    const form = await openForm();

    expect(timesheetFormRows(form)).toEqual([
      { project: 'Mobile · Acme', cells: ['Wed 17 []'] },
      { project: 'Website · Acme', cells: ['Wed 17 []'] },
    ]);

    const since = t.slackApi.mark();
    const answer = await submit(form, {
      [cellKey(website.id, WED)]: '5',
      [cellKey(mobile.id, WED)]: '3',
      [TimesheetFormActionId.Comment]: 'Sprint review',
    });

    expect(answer.body).toEqual({ response_action: 'clear' });
    expect(await entriesOf()).toEqual([
      'Mobile 2026-06-08 60 draft',
      'Mobile 2026-06-17 180 draft Sprint review',
      'Website 2026-06-08 60 draft',
      'Website 2026-06-17 300 draft Sprint review',
    ]);
    expect(noticeOf(await publishedHome(t, workspace, member, since))).toBe(
      '✅ Saved. Wed 17 Jun: 8h.',
    );
  });

  it('changes the day in the form', async () => {
    await entry(website, LAST_WEEK);
    await entry(website, THU, { minutes: 180 });

    const changed = await actOnForm(
      await openForm(),
      TimesheetFormActionId.Day,
      THU,
    );

    expect(timesheetFormRows(changed)).toEqual([
      { project: 'Website · Acme', cells: ['Thu 18 [3]'] },
    ]);

    await submit(changed, { [cellKey(website.id, THU)]: '4' });

    expect(await entriesOf()).toEqual([
      'Website 2026-06-08 60 draft',
      'Website 2026-06-18 240 draft',
    ]);
  });

  it('shows what the week form saved', async () => {
    await entry(website, LAST_WEEK);
    await submit(await openForm(TimeEntriesTabViewActionId.FillWeek), {
      [cellKey(website.id, WED)]: '5',
    });

    const form = await openForm();

    expect(timesheetFormRows(form)).toEqual([
      { project: 'Website · Acme', cells: ['Wed 17 [5]'] },
    ]);

    const added = await actOnForm(
      form,
      TimesheetFormActionId.AddProject,
      mobile.id,
    );

    expect(timesheetFormRows(added)).toEqual([
      { project: 'Mobile · Acme', cells: ['Wed 17 []'] },
      { project: 'Website · Acme', cells: ['Wed 17 [5]'] },
    ]);
  });

  it('refuses a comment when no hours changed', async () => {
    const draft = await entry(website, WED, { description: 'Design' });

    const answer = await submit(await openForm(), {
      [TimesheetFormActionId.Comment]: 'Review',
    });

    expect(answer.body).toEqual({
      response_action: 'errors',
      errors: {
        [COMMENT_BLOCK_ID]:
          'The comment goes on the entries whose hours you add or change: nothing changed.',
      },
    });
    expect(await entriesOf()).toEqual(['Website 2026-06-17 60 draft Design']);
    expect(await workspace.row('time_entries', draft.id)).toEqual(draft);
  });

  it("goes back to My time on the saved day's week", async () => {
    await entry(website, LAST_WEEK);
    // Opened from last week, the form is still today's.
    const lastWeek = await actOnTab(
      t,
      workspace,
      member,
      await openAppHomeTab(t, workspace, member, MY_TIME),
      TimeEntriesTabViewActionId.PreviousWeek,
    );
    let since = t.slackApi.mark();

    await submit(
      await openModalFrom(
        t,
        workspace,
        member,
        lastWeek,
        TimeEntriesTabViewActionId.FillDay,
      ),
      { [cellKey(website.id, WED)]: '5' },
    );

    let myTime = await publishedHome(t, workspace, member, since);

    expect(noticeOf(myTime)).toBe('✅ Saved. Wed 17 Jun: 5h.');
    expect(timesheetStatusOf(myTime)).toBe(
      '🕒 Week of 15 Jun · 5h · 📝 1 draft',
    );

    // Another day chosen in the form: that day's week.
    const changed = await actOnForm(
      await openForm(),
      TimesheetFormActionId.Day,
      '2026-06-09',
    );
    since = t.slackApi.mark();

    await submit(changed, { [cellKey(website.id, '2026-06-09')]: '2' });

    myTime = await publishedHome(t, workspace, member, since);

    expect(noticeOf(myTime)).toBe('✅ Saved. Tue 9 Jun: 2h.');
    expect(timesheetStatusOf(myTime)).toBe(
      '🕒 Week of 8 Jun · 3h · 📝 2 drafts',
    );
  });

  it("keeps an entry's description when the comment is left empty", async () => {
    const draft = await entry(website, WED, { description: 'Design' });
    const form = await openForm();

    await submit(form, { [cellKey(website.id, WED)]: '2' });

    expect(await workspace.row('time_entries', draft.id)).toMatchObject({
      minutes: 120,
      description: 'Design',
    });

    await submit(await openForm(), {
      [cellKey(website.id, WED)]: '3',
      [TimesheetFormActionId.Comment]: 'Review',
    });

    expect(await workspace.row('time_entries', draft.id)).toMatchObject({
      minutes: 180,
      description: 'Review',
    });
  });

  it('escapes the comment where it shows', async () => {
    await entry(website, LAST_WEEK);
    const since = t.slackApi.mark();

    await submit(await openForm(), {
      [cellKey(website.id, WED)]: '1',
      [TimesheetFormActionId.Comment]: '<!channel>',
    });

    expect(await entriesOf()).toContain(
      'Website 2026-06-17 60 draft <!channel>',
    );

    const myTime = JSON.stringify(
      await publishedHome(t, workspace, member, since),
    );

    expect(myTime).toContain('&lt;!channel&gt;');
    expect(myTime).not.toContain('<!channel>');
  });
});
