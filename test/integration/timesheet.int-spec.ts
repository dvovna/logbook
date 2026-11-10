import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  actionIdsOf,
  buttonText,
  listItems,
  tableRows,
  timesheetStatusOf,
} from './support/tab-readers';
import { travelTo } from './support/clock';
import { actOnTab, openAppHomeTab } from './support/app-home';

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
      ['Website · Acme', '2h', '', '1h 30m', '', '', '3h 30m'],
      ['Total', '2h', '', '1h 30m', '', '', '3h 30m'],
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
    expect(ids).not.toContain(TimeEntriesTabViewActionId.FillWeek);
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
