import { sql } from 'kysely';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { getDisplayTime } from '@common/utils/time.utils';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { DEFAULT_TIME_ENTRIES_EXPORT_LIMITS } from 'src/time-entries/constants/time-entries-export';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { tableRows } from './support/tab-readers';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// More entries than a page of the CSV, so that reading them all at once
// shows; each day has each person's time on both projects.
const ENTRIES = 12_000;
const PERIOD = { fromDate: '2026-01-01', toDate: '2026-06-30' };
const { pageSize } = DEFAULT_TIME_ENTRIES_EXPORT_LIMITS;

// What the seeded entries add up to: 15, 30, 45 and 60 minutes in turn.
const TOTAL_MINUTES = Array.from(
  { length: ENTRIES },
  (_, g) => 15 * (1 + (g % 4)),
).reduce((sum, minutes) => sum + minutes, 0);

// The lines of a CSV file the app sent, without its byte order mark.
const csvLines = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n$/, '')
    .split('\r\n');

// Reports and their CSV add time up in the database and read the CSV a page
// at a time: no statement returns every entry of the period.
describe('Time reports of many entries', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let manager: Tables<'users'>;
  let people: Tables<'users'>[];

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin, name: 'Ann' });
    manager = await workspace.addUser({ role: UserRole.Manager });
    const team = await workspace.addTeam({
      manager_approvers: [manager.slack_id],
    });
    // Names whose order differs between bytes and the app's localeCompare.
    people = await Promise.all(
      ['Zoë Zed', 'anna lower', 'Émile Accent'].map((name) =>
        workspace.addUser({ name, team_id: team.id }),
      ),
    );
    const acme = await workspace.addClient({ name: 'Acme' });
    const projects = await Promise.all([
      workspace.addProject({
        name: 'website',
        client_id: acme.id,
        hourly_rate: 100.01,
      }),
      workspace.addProject({ name: 'Ånalysis', billable: false }),
    ]);

    await sql`
      insert into time_entries (slack_team_id, user_id, team_id, project_id,
        client_id, work_date, minutes, billable, status, description,
        created_by, updated_by)
      select ${workspace.id}, person.id, person.team_id, project.id,
        project.client_id, ${PERIOD.fromDate}::date + g % 181,
        15 * (1 + g % 4), project.billable,
        (array['draft', 'submitted', 'approved'])[1 + g / 3 % 3],
        'Entry ' || g,
        person.id, person.id
      from generate_series(0, ${ENTRIES - 1}) g
      join users person on person.id
        = (${people.map(({ id }) => id)}::uuid[])[1 + g % ${people.length}]
      join projects project on project.id
        = (${projects.map(({ id }) => id)}::uuid[])[1 + g / 7 % ${projects.length}]
    `.execute(t.db);
  });

  // The most rows a statement returned since `since`.
  const mostRows = (since: number) =>
    Math.max(...t.sql.statements(since).map(({ rows }) => rows ?? 0));

  const showReport = async (user: Tables<'users'>, kind: TimeReportKind) => {
    const form = await openModalFrom(
      t,
      workspace,
      user,
      await openAppHomeTab(t, workspace, user, [NavigationActionId.Reports]),
      ReportsTabActionId.TimeReport,
    );
    const since = t.slackApi.mark();
    const sqlSince = t.sql.mark();

    await t.slack
      .submitView(workspace, user, form, { kind, ...PERIOD })
      .expect(200);

    const reports: View = await publishedHome(t, workspace, user, since);

    return { reports, mostRows: mostRows(sqlSince) };
  };

  it('adds the entries up in the database', async () => {
    const { reports, mostRows: rows } = await showReport(
      admin,
      TimeReportKind.Person,
    );

    expect(tableRows(reports).map(([name, hours]) => [name, hours])).toEqual([
      ['Person', 'Hours'],
      ...people
        .map(({ name }) => name)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => [name, getDisplayTime(TOTAL_MINUTES / 3)]),
      ['Total', getDisplayTime(TOTAL_MINUTES)],
    ]);
    expect(rows).toBeLessThan(20);
  });

  it("counts who hasn't submitted in the database", async () => {
    const { reports, mostRows: rows } = await showReport(
      manager,
      TimeReportKind.Missing,
    );

    const [header, nothingLogged, ...unsubmitted] = tableRows(reports).map(
      ([name]) => name,
    );

    expect([header, nothingLogged]).toEqual(['Person', manager.name]);
    expect(unsubmitted.sort()).toEqual(people.map(({ name }) => name).sort());
    expect(rows).toBeLessThan(20);
  });

  it('reads the CSV a page at a time, in the order the app sorts names', async () => {
    const { reports } = await showReport(admin, TimeReportKind.Project);
    const since = t.slackApi.mark();
    const sqlSince = t.sql.mark();

    await actOnTab(
      t,
      workspace,
      admin,
      reports,
      ReportsTabActionId.ExportTimeReport,
    );

    expect(
      t.slackApi
        .postedMessages(workspace.token, admin.slack_id, { since })
        .map(({ text }) => text),
    ).toEqual([
      expect.stringMatching(
        new RegExp(
          `\\(everyone's time\\): ${ENTRIES} entries, ${getDisplayTime(TOTAL_MINUTES)}\\.$`,
        ),
      ),
    ]);

    const [file] = t.slackApi.uploadedFiles(
      workspace.token,
      `D${admin.slack_id.slice(1)}`,
      { since },
    );
    const [header, ...lines] = csvLines(file.content);
    const fields = lines.map((line) => line.split(','));
    const sorted = [...fields].sort(
      (a, b) =>
        a[0].localeCompare(b[0]) ||
        a[1].localeCompare(b[1]) ||
        a[5].localeCompare(b[5]),
    );

    expect(header).toMatch(/^Date,Person,/);
    // Every entry once, in order across the pages.
    expect(new Set(fields.map((line) => line[6]))).toEqual(
      new Set(Array.from({ length: ENTRIES }, (_, g) => `Entry ${g}`)),
    );
    expect(fields.map((line) => line.slice(0, 6))).toEqual(
      sorted.map((line) => line.slice(0, 6)),
    );
    const firstDay = fields.filter(([date]) => date === PERIOD.fromDate);

    // In bytes: Zoë, anna, Émile; website, Ånalysis.
    expect([...new Set(firstDay.map((line) => line[1]))]).toEqual([
      'anna lower',
      'Émile Accent',
      'Zoë Zed',
    ]);
    expect(
      [...new Set(firstDay.map((line) => `${line[1]}/${line[5]}`))].slice(0, 2),
    ).toEqual(['anna lower/Ånalysis', 'anna lower/website']);

    const statements = t.sql.statements(sqlSince);

    expect(mostRows(sqlSince)).toBeLessThanOrEqual(pageSize);
    expect(
      statements.filter(({ rows }) => rows === pageSize).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
