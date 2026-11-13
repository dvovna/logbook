import { sql } from 'kysely';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { PERIOD_PRESET_ACTION_ID } from '@modules/slack/tabs/reports/views/period-fields';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction, textOf } from './support/block-kit';
import { actionIdsOf, sectionTexts, tableRows } from './support/tab-readers';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// Home → Time & Billing.
const REPORTS_TAB = [NavigationActionId.Reports];

const HEADER = ['Project', 'Person', 'Hours', 'Billable', 'Rate', 'Amount'];

describe('Billing reports', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let member: Tables<'users'>;
  let acme: Tables<'clients'>;
  let website: Tables<'projects'>;

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
    member = await workspace.addUser({ name: 'Mia Member' });
    acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
    });
  });

  const openReportForm = async (user = admin) =>
    openModalFrom(
      t,
      workspace,
      user,
      await openAppHomeTab(t, workspace, user, REPORTS_TAB),
      ReportsTabActionId.BillingReport,
    );

  // Sends the form; it closes and Reports shows the report.
  const submitReport = async (form: View, values: Record<string, string>) => {
    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, admin, form, values)
      .expect(200);

    expect(response.body).toEqual({ response_action: 'clear' });

    return publishedHome(t, workspace, admin, since);
  };

  const reportTexts = (view: View) =>
    sectionTexts(view).filter((text) =>
      /^\*(Billing report|By project|By person)/.test(text),
    );

  const setProjectRate = (project: Tables<'projects'>, hourlyRate: number) =>
    t.db
      .updateTable('projects')
      .set({ hourly_rate: hourlyRate })
      .where('id', '=', project.id)
      .execute();

  const approved = (
    user: Tables<'users'>,
    project: Tables<'projects'>,
    fields: Partial<Tables<'time_entries'>> = {},
  ) =>
    workspace.addTimeEntry(user, project, {
      status: TimeEntryStatus.Approved,
      work_date: '2026-10-15',
      ...fields,
    });

  it('fills its dates from a quick period', async () => {
    const form = await openReportForm();
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(
        workspace,
        admin,
        form,
        PERIOD_PRESET_ACTION_ID,
        'last_quarter',
      )
      .expect(200);
    await t.idle();

    const filled = t.slackApi.updatedModal(workspace.token, { since });

    expect(
      ['fromDate', 'toDate'].map(
        (actionId) => findAction(filled.blocks, actionId).element.initial_date,
      ),
    ).toEqual(['2026-01-01', '2026-03-31']);
    // The client the admin chose stays: its block is the same.
    expect(findAction(filled.blocks, 'clientId').blockId).toBe(
      findAction(form.blocks, 'clientId').blockId,
    );
  });

  it('leaves a quick period out when a later one changed the form first', async () => {
    const form = await openReportForm();
    const choose = (preset: string) =>
      t.slack
        .actOnView(workspace, admin, form, PERIOD_PRESET_ACTION_ID, preset)
        .expect(200);

    await choose('last_quarter');
    await t.idle();
    const since = t.slackApi.mark();

    // A second choice in the form as it was before the first one's rebuild:
    // Slack refuses its update (hash_conflict).
    await choose('last_month');
    await t.idle();

    expect(
      t.slackApi.callsWith(workspace.token, 'views.update', { since }),
    ).toEqual([]);
  });

  it("sums a client's approved hours by project and person", async () => {
    const support = await workspace.addProject({
      name: 'Support',
      client_id: acme.id,
      billable: false,
      archived_at: new Date().toISOString(),
    });
    const globex = await workspace.addClient({ name: 'Globex' });
    const shop = await workspace.addProject({
      name: 'Shop',
      client_id: globex.id,
    });
    await approved(member, website, { minutes: 120 });
    await approved(admin, website, { minutes: 60 });
    await approved(member, support, { minutes: 30, billable: false });
    // Logged before entries got their client: counted through the project.
    await approved(member, website, { minutes: 15, client_id: null });
    await approved(member, website, {
      minutes: 60,
      status: TimeEntryStatus.Submitted,
    });
    await approved(member, website, { work_date: '2026-11-01' });
    await approved(member, shop);
    await approved(member, website, {
      deleted_at: new Date().toISOString(),
      deleted_by: admin.id,
    });

    const form = await openReportForm();
    expect(
      findAction(form.blocks, 'clientId').element.options.map(
        ({ value }: { value: string }) => value,
      ),
    ).toEqual([acme.id, globex.id]);

    const reports = await submitReport(form, {
      clientId: acme.id,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });

    // No rates yet: billable time without an amount.
    expect(reportTexts(reports)).toEqual([
      '*Billing report: Acme* · 1–31 Oct 2026\nApproved: *3h 45m*, billable *3h 15m* · Amount: *$0.00*\n_No rate: 3h 15m of billable time, not in the amount_\n_Not approved yet: 1h_',
      '*By project*\n• Website — 3h 15m · 3h 15m with no rate\n• Support — 30m',
      '*By person*\n• Mia Member — 2h 45m · 2h 15m with no rate\n• Ann Admin — 1h · 1h with no rate',
    ]);
    expect(tableRows(reports)).toEqual([
      HEADER,
      ['Website', 'Mia Member', '2h 15m', '2h 15m', '–', '–'],
      ['Website', 'Ann Admin', '1h', '1h', '–', '–'],
      ['Support', 'Mia Member', '30m', '0h', '–', '–'],
      ['Total', '–', '3h 45m', '3h 15m', '–', '$0.00'],
    ]);
  });

  it("bills billable time at the person's own rate on a project, else at the project's", async () => {
    await t.db
      .updateTable('slack_teams')
      .set({ currency: 'EUR' })
      .where('id', '=', workspace.id)
      .execute();
    await setProjectRate(website, 120.5);
    await workspace.addPersonRate(website, admin, 200);
    const design = await workspace.addProject({
      name: 'Design',
      client_id: acme.id,
    });
    const support = await workspace.addProject({
      name: 'Support',
      client_id: acme.id,
      billable: false,
      hourly_rate: 80,
    });
    await approved(member, website, { minutes: 90 });
    await approved(admin, website, { minutes: 45 });
    await approved(member, design, { minutes: 60 });
    // Ann's own rate is for Website only.
    await approved(admin, design, { minutes: 15 });
    await approved(member, support, { minutes: 30, billable: false });

    const reports = await submitReport(await openReportForm(), {
      clientId: acme.id,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });

    expect(reportTexts(reports)).toEqual([
      '*Billing report: Acme* · 1–31 Oct 2026\nApproved: *4h*, billable *3h 30m* · Amount: *€330.75*\n_No rate: 1h 15m of billable time, not in the amount_',
      '*By project*\n• Website — 2h 15m · €330.75\n• Design — 1h 15m · 1h 15m with no rate\n• Support — 30m',
      '*By person*\n• Mia Member — 3h · €180.75 · 1h with no rate\n• Ann Admin — 1h · €150.00 · 15m with no rate',
    ]);
    expect(tableRows(reports)).toEqual([
      HEADER,
      ['Website', 'Mia Member', '1h 30m', '1h 30m', '€120.50/h', '€180.75'],
      ['Website', 'Ann Admin', '45m', '45m', '€200.00/h', '€150.00'],
      ['Design', 'Mia Member', '1h', '1h', '–', '–'],
      ['Design', 'Ann Admin', '15m', '15m', '–', '–'],
      // Not billable: a rate, but nothing to bill.
      ['Support', 'Mia Member', '30m', '0h', '€80.00/h', '–'],
      ['Total', '–', '4h', '3h 30m', '–', '€330.75'],
    ]);
  });

  // The database answers a query with 1000 rows at most and says nothing
  // about the rest.
  it('counts more entries than one answer of the database holds', async () => {
    await setProjectRate(website, 100);
    await workspace.addTimeEntries(
      member,
      website,
      Array.from({ length: 1001 }, (_, index) => ({
        status: TimeEntryStatus.Approved,
        work_date: `2026-10-${String((index % 31) + 1).padStart(2, '0')}`,
        minutes: 15,
      })),
    );
    const form = await openReportForm();

    const reports = await submitReport(form, {
      clientId: acme.id,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });

    expect(reportTexts(reports)).toEqual([
      '*Billing report: Acme* · 1–31 Oct 2026\nApproved: *250h 15m*, billable *250h 15m* · Amount: *$25,025.00*',
    ]);
    expect(tableRows(reports)).toEqual([
      HEADER,
      [
        'Website',
        'Mia Member',
        '250h 15m',
        '250h 15m',
        '$100.00/h',
        '$25,025.00',
      ],
      ['Total', '–', '250h 15m', '250h 15m', '–', '$25,025.00'],
    ]);
  });

  // A statement takes at most 65535 parameters, and the report checks every
  // approved entry against the billing snapshots.
  it('reports more approved entries than a statement takes parameters', async () => {
    await setProjectRate(website, 100);
    await sql`
      insert into time_entries (
        slack_team_id, user_id, project_id, client_id, work_date, minutes,
        status, created_by, updated_by
      )
      select ${workspace.id}::uuid, ${member.id}::uuid, ${website.id}::uuid,
        ${acme.id}::uuid, date '2026-10-01' + g % 31, 15,
        ${TimeEntryStatus.Approved}, ${member.id}::uuid, ${member.id}::uuid
      from generate_series(1, 65536) g
    `.execute(t.db);
    // 1 October's 2114 entries are in a snapshot.
    const snapshot = await t.db
      .insertInto('billing_snapshots')
      .values({
        slack_team_id: workspace.id,
        client_id: acme.id,
        period_start: '2026-10-01',
        period_end: '2026-10-01',
        currency: 'USD',
        total_minutes: 2114 * 15,
        billable_minutes: 2114 * 15,
        total_amount: 2114 * 25,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await sql`
      insert into billing_snapshot_entries (
        slack_team_id, snapshot_id, time_entry_id, minutes, billable,
        hourly_rate, amount
      )
      select slack_team_id, ${snapshot.id}::uuid, id, minutes, billable, 100, 25
      from time_entries
      where slack_team_id = ${workspace.id}::uuid and work_date = '2026-10-01'
    `.execute(t.db);

    const reports = await submitReport(await openReportForm(), {
      clientId: acme.id,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });

    expect(reportTexts(reports)).toEqual([
      '*Billing report: Acme* · 1–31 Oct 2026\nApproved: *16384h*, billable *16384h* · Amount: *$1,638,400.00*\n_In billing snapshots already: 528h 30m of the approved time_',
    ]);
  });

  it('says when nothing was approved', async () => {
    await approved(member, website, { status: TimeEntryStatus.Draft });
    const form = await openReportForm();

    const reports = await submitReport(form, {
      clientId: acme.id,
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });

    expect(reportTexts(reports)).toEqual([
      '*Billing report: Acme* · 1–31 Oct 2026\nApproved: *0h*, billable *0h* · Amount: *$0.00*\n_Not approved yet: 1h_',
    ]);
    expect(textOf(reports)).toContain(
      '_No approved time for this client in this period._',
    );
    expect(tableRows(reports)).toEqual([]);
  });

  it('defaults to this month and checks the period', async () => {
    // Today is 2026-06-17 (TEST_NOW).
    const form = await openReportForm();

    expect(findAction(form.blocks, 'fromDate').element.initial_date).toBe(
      '2026-06-01',
    );
    expect(findAction(form.blocks, 'toDate').element.initial_date).toBe(
      '2026-06-17',
    );

    const response = await t.slack
      .submitView(workspace, admin, form, {
        clientId: acme.id,
        fromDate: '2026-10-31',
        toDate: '2026-10-01',
      })
      .expect(200);

    expect(response.body).toEqual({
      response_action: 'errors',
      errors: { to_date_block: 'End date must not be before the start date' },
    });
  });

  it.each([UserRole.Manager, UserRole.HR])(
    'is for Admin and Finance only, not %s',
    async (role) => {
      const manager = await workspace.addUser({ role });
      const reports = await openAppHomeTab(t, workspace, manager, REPORTS_TAB);
      expect(actionIdsOf(reports)).not.toContain(
        ReportsTabActionId.BillingReport,
      );

      const response = await t.slack
        .submitView(workspace, manager, await openReportForm(), {
          clientId: acme.id,
        })
        .expect(200);

      expect(response.body.view.title.text).toBe('Forbidden');
    },
  );
});
