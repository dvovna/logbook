import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { NO_FILES_PERMISSION } from '@modules/slack/common/services/dm-file.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import {
  actionIdsOf,
  noticeOf,
  sectionTexts,
  tableRows,
} from './support/tab-readers';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

const REPORTS_TAB = [NavigationActionId.Reports];

// June 2026; today is Wednesday 2026-06-17 (TEST_NOW).
const JUNE = { fromDate: '2026-06-01', toDate: '2026-06-30' };

// The lines of a CSV file the app sent, without its byte order mark.
const csvLines = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n$/, '')
    .split('\r\n');

describe('Time reports', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let manager: Tables<'users'>;
  let mia: Tables<'users'>;
  let otto: Tables<'users'>;
  let backend: Tables<'teams'>;
  let design: Tables<'teams'>;
  let website: Tables<'projects'>;
  let internal: Tables<'projects'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({
      role: UserRole.Admin,
      name: 'Ann Admin',
    });
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Max Manager',
    });
    backend = await workspace.addTeam({
      name: 'Backend',
      manager_approvers: [manager.slack_id],
    });
    design = await workspace.addTeam({ name: 'Design' });
    mia = await workspace.addUser({ name: 'Mia Member', team_id: backend.id });
    otto = await workspace.addUser({ name: 'Otto Other', team_id: design.id });
    const acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
      hourly_rate: 100,
    });
    internal = await workspace.addProject({
      name: 'Internal',
      billable: false,
    });
  });

  // Approved, on 10 June, and billable as its project, as the app logs it.
  const logged = (
    user: Tables<'users'>,
    project: Tables<'projects'>,
    fields: Partial<Tables<'time_entries'>> = {},
  ) =>
    workspace.addTimeEntry(user, project, {
      status: TimeEntryStatus.Approved,
      work_date: '2026-06-10',
      billable: project.billable,
      ...fields,
    });

  const openForm = async (user: Tables<'users'>) =>
    openModalFrom(
      t,
      workspace,
      user,
      await openAppHomeTab(t, workspace, user, REPORTS_TAB),
      ReportsTabActionId.TimeReport,
    );

  // Sends the form; it closes and Reports shows the report.
  const showReport = async (
    user: Tables<'users'>,
    kind: TimeReportKind,
    period = JUNE,
  ) => {
    const form = await openForm(user);
    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, user, form, { kind, ...period })
      .expect(200);

    expect(response.body).toEqual({ response_action: 'clear' });

    return publishedHome(t, workspace, user, since);
  };

  const reportTexts = (view: View) =>
    sectionTexts(view).filter((text) => /^\*(Time by|Who hasn't)/.test(text));

  const kindsOf = (form: View) =>
    findAction(form.blocks, 'kind').element.options.map(
      ({ value }: { value: string }) => value,
    );

  describe('time by client, project, person or team', () => {
    beforeEach(async () => {
      await logged(mia, website, { minutes: 120 });
      await logged(mia, website, {
        minutes: 60,
        status: TimeEntryStatus.Draft,
      });
      await logged(otto, website, {
        minutes: 30,
        status: TimeEntryStatus.Submitted,
      });
      await logged(mia, internal, { minutes: 60 });
      await logged(manager, internal, { minutes: 15 });
      // Not counted: another month, and a deleted entry.
      await logged(mia, website, { work_date: '2026-07-01' });
      await logged(mia, website, {
        deleted_at: new Date().toISOString(),
        deleted_by: mia.id,
      });
    });

    it("shows Admin everyone's time, with amounts at today's rates", async () => {
      const reports = await showReport(admin, TimeReportKind.Project);

      expect(reportTexts(reports)).toEqual([
        "*Time by project* · 1–30 Jun 2026 · Everyone's time\nLogged *4h 45m* · billable *3h 30m* · approved *3h 15m* · amount *$350.00*",
      ]);
      expect(tableRows(reports)).toEqual([
        ['Project', 'Hours', 'Billable', 'Approved', 'Amount'],
        ['Website', '3h 30m', '3h 30m', '2h', '$350.00'],
        ['Internal', '1h 15m', '0h', '1h 15m', '$0.00'],
        ['Total', '4h 45m', '3h 30m', '3h 15m', '$350.00'],
      ]);
      expect(actionIdsOf(reports)).toContain(
        ReportsTabActionId.ExportTimeReport,
      );
    });

    it.each([
      [
        TimeReportKind.Client,
        [
          ['Acme', '3h 30m'],
          ['No client', '1h 15m'],
        ],
      ],
      [
        TimeReportKind.Person,
        [
          ['Mia Member', '4h'],
          ['Otto Other', '30m'],
          ['Max Manager', '15m'],
        ],
      ],
      [
        TimeReportKind.Team,
        [
          ['Backend', '4h'],
          ['Design', '30m'],
          ['No team', '15m'],
        ],
      ],
    ])('groups by %s', async (kind, rows) => {
      const reports = await showReport(admin, kind);

      expect(tableRows(reports).map(([name, hours]) => [name, hours])).toEqual([
        expect.any(Array),
        ...rows,
        ['Total', '4h 45m'],
      ]);
    });

    it("shows a manager their teams' time and their own, without amounts", async () => {
      const reports = await showReport(manager, TimeReportKind.Person);

      expect(reportTexts(reports)).toEqual([
        "*Time by person* · 1–30 Jun 2026 · Your teams' time and yours\nLogged *4h 15m* · billable *3h* · approved *3h 15m*",
      ]);
      expect(tableRows(reports)).toEqual([
        ['Person', 'Hours', 'Billable', 'Approved'],
        ['Mia Member', '4h', '3h', '3h'],
        ['Max Manager', '15m', '0h', '15m'],
        ['Total', '4h 15m', '3h', '3h 15m'],
      ]);
    });

    it('opens Reports to a member, with their own time only', async () => {
      const reports = await openAppHomeTab(t, workspace, mia, REPORTS_TAB);
      expect(actionIdsOf(reports)).not.toContain(
        ReportsTabActionId.BillingReport,
      );
      expect(actionIdsOf(reports)).not.toContain(NavigationActionId.TimeLogs);
      expect(sectionTexts(reports)).toContain(
        '*This week*\n*0h* logged · *0h* billable',
      );

      expect(kindsOf(await openForm(mia))).toEqual([
        TimeReportKind.Client,
        TimeReportKind.Project,
        TimeReportKind.Person,
        TimeReportKind.Team,
      ]);

      const report = await showReport(mia, TimeReportKind.Person);
      expect(reportTexts(report)).toEqual([
        '*Time by person* · 1–30 Jun 2026 · Your time\nLogged *4h* · billable *3h* · approved *3h*',
      ]);
      expect(tableRows(report)).toEqual([
        ['Person', 'Hours', 'Billable', 'Approved'],
        ['Mia Member', '4h', '3h', '3h'],
        ['Total', '4h', '3h', '3h'],
      ]);
    });

    it('says when nothing was logged', async () => {
      const reports = await showReport(admin, TimeReportKind.Project, {
        fromDate: '2026-05-01',
        toDate: '2026-05-31',
      });

      expect(reportTexts(reports)).toEqual([
        "*Time by project* · 1–31 May 2026 · Everyone's time\nLogged *0h* · billable *0h* · approved *0h* · amount *$0.00*",
      ]);
      expect(tableRows(reports)).toEqual([]);
      expect(actionIdsOf(reports)).not.toContain(
        ReportsTabActionId.ExportTimeReport,
      );
    });
  });

  it('defaults to this month and checks the period', async () => {
    const form = await openForm(admin);
    expect(findAction(form.blocks, 'kind').element.initial_option.value).toBe(
      TimeReportKind.Project,
    );
    expect(findAction(form.blocks, 'fromDate').element.initial_date).toBe(
      '2026-06-01',
    );
    expect(findAction(form.blocks, 'toDate').element.initial_date).toBe(
      '2026-06-17',
    );

    const submit = async (fromDate: string, toDate: string) =>
      (
        await t.slack
          .submitView(workspace, admin, form, {
            kind: TimeReportKind.Project,
            fromDate,
            toDate,
          })
          .expect(200)
      ).body;

    expect(await submit('2026-06-30', '2026-06-01')).toEqual({
      response_action: 'errors',
      errors: { to_date_block: 'End date must not be before the start date' },
    });
    expect(await submit('2025-06-01', '2026-06-30')).toEqual({
      response_action: 'errors',
      errors: { to_date_block: 'Choose a period of a year at most' },
    });
  });

  describe("who hasn't submitted", () => {
    it("lists the manager's people who logged nothing or still have drafts or rejected time", async () => {
      const bob = await workspace.addUser({
        name: 'Bob Blank',
        team_id: backend.id,
      });
      const sam = await workspace.addUser({
        name: 'Sam Submitted',
        team_id: backend.id,
      });
      const rita = await workspace.addUser({
        name: 'Rita Rejected',
        team_id: backend.id,
      });
      await workspace.addUser({
        name: 'Ian Inactive',
        team_id: backend.id,
        is_active: false,
      });
      await logged(mia, website, { minutes: 90 });
      await logged(mia, website, {
        minutes: 30,
        status: TimeEntryStatus.Draft,
      });
      await logged(sam, website, { status: TimeEntryStatus.Submitted });
      await logged(rita, internal, {
        minutes: 45,
        status: TimeEntryStatus.Rejected,
      });
      // Outside the period: Bob still logged nothing in it.
      await logged(bob, website, { work_date: '2026-05-29' });
      await logged(manager, internal);

      const reports = await showReport(manager, TimeReportKind.Missing);

      expect(reportTexts(reports)).toEqual([
        "*Who hasn't submitted* · 1–30 Jun 2026 · Your teams' time and yours\n*3* of *5* people logged nothing, or have drafts or rejected time not sent for approval.",
      ]);
      // Otto is in a team Max doesn't manage; Ian is deactivated.
      expect(tableRows(reports)).toEqual([
        ['Person', 'Team', 'Logged', 'Not submitted'],
        ['Bob Blank', 'Backend', '0h', '–'],
        ['Rita Rejected', 'Backend', '45m', '45m (1 entry)'],
        ['Mia Member', 'Backend', '2h', '30m (1 entry)'],
      ]);
    });

    it('says when everyone has submitted', async () => {
      await logged(mia, website, { status: TimeEntryStatus.Submitted });
      await logged(manager, internal);

      const reports = await showReport(manager, TimeReportKind.Missing);

      expect(reportTexts(reports)).toEqual([
        "*Who hasn't submitted* · 1–30 Jun 2026 · Your teams' time and yours\nEveryone (*2*) has sent their time of this period for approval.",
      ]);
      expect(tableRows(reports)).toEqual([]);
    });

    it('is not offered to members', async () => {
      expect(kindsOf(await openForm(manager))).toContain(
        TimeReportKind.Missing,
      );
      expect(kindsOf(await openForm(mia))).not.toContain(
        TimeReportKind.Missing,
      );
    });
  });

  describe('CSV export', () => {
    // The DM channel of a user, as Slack answers a message to their user ID.
    const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

    // Shows the report, clicks "Send CSV" and returns the Reports tab the
    // app re-renders, with the messages and files it sent.
    const exportReport = async (user: Tables<'users'>) => {
      const reports = await showReport(user, TimeReportKind.Project);
      const since = t.slackApi.mark();
      const after = await actOnTab(
        t,
        workspace,
        user,
        reports,
        ReportsTabActionId.ExportTimeReport,
      );

      return {
        after,
        messages: t.slackApi.postedMessages(workspace.token, user.slack_id, {
          since,
        }),
        files: t.slackApi.uploadedFiles(workspace.token, dmOf(user), {
          since,
        }),
      };
    };

    beforeEach(async () => {
      await logged(mia, website, {
        minutes: 90,
        description: 'API review, part 1',
      });
      await logged(mia, internal, {
        work_date: '2026-06-02',
        minutes: 30,
        status: TimeEntryStatus.Draft,
        description: '=HYPERLINK("http://evil.example")',
      });
      await logged(otto, website, {
        work_date: '2026-06-11',
        minutes: 15,
        status: TimeEntryStatus.Submitted,
      });
    });

    it('sends Admin every entry of the period, with rates and amounts, in a DM', async () => {
      await workspace.addPersonRate(website, otto, 140);

      const { after, messages, files } = await exportReport(admin);

      expect(noticeOf(after)).toBe('📨 Sending the CSV to your DMs.');
      expect(messages.map(({ text, channel }) => ({ text, channel }))).toEqual([
        {
          text: "📄 Time report, 1–30 Jun 2026 (everyone's time): 3 entries, 2h 15m.",
          channel: dmOf(admin),
        },
      ]);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        filename: 'time-report-2026-06-01-to-2026-06-30.csv',
        title: 'Time report, 1–30 Jun 2026',
      });
      expect(csvLines(files[0].content)).toEqual([
        'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status,Rate,Amount,Currency',
        `2026-06-02,Mia Member,${mia.email},Backend,,Internal,"'=HYPERLINK(""http://evil.example"")",0.50,no,draft,,,USD`,
        `2026-06-10,Mia Member,${mia.email},Backend,Acme,Website,"API review, part 1",1.50,yes,approved,100.00,150.00,USD`,
        `2026-06-11,Otto Other,${otto.email},Design,Acme,Website,,0.25,yes,submitted,140.00,35.00,USD`,
      ]);
    });

    it("sends a manager their teams' entries without rates", async () => {
      const { files } = await exportReport(manager);

      expect(csvLines(files[0].content)).toEqual([
        'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status',
        `2026-06-02,Mia Member,${mia.email},Backend,,Internal,"'=HYPERLINK(""http://evil.example"")",0.50,no,draft`,
        `2026-06-10,Mia Member,${mia.email},Backend,Acme,Website,"API review, part 1",1.50,yes,approved`,
      ]);
    });

    it('sends a member only their own entries', async () => {
      const { messages, files } = await exportReport(otto);

      expect(messages.map(({ text }) => text)).toEqual([
        '📄 Time report, 1–30 Jun 2026 (your time): 1 entry, 15m.',
      ]);
      expect(csvLines(files[0].content)).toEqual([
        'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status',
        `2026-06-11,Otto Other,${otto.email},Design,Acme,Website,,0.25,yes,submitted`,
      ]);
    });

    it('asks for a reinstall when the workspace has not granted files:write', async () => {
      t.slackApi.failNext('files.completeUploadExternal', 1, 'missing_scope');

      const { messages, files } = await exportReport(admin);

      expect(files).toEqual([]);
      expect(
        t.slackApi
          .messageUpdates(workspace.token, messages[0])
          .map(({ text }) => text),
      ).toEqual([
        `📄 Time report, 1–30 Jun 2026 (everyone's time): 3 entries, 2h 15m.\n${NO_FILES_PERMISSION}`,
      ]);
    });

    it('exports only a time report on show', async () => {
      const reports = await showReport(manager, TimeReportKind.Missing);

      expect(actionIdsOf(reports)).not.toContain(
        ReportsTabActionId.ExportTimeReport,
      );
    });
  });
});
