import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { findAction } from './support/block-kit';
import { actionIdsOf, sectionTexts } from './support/tab-readers';
import { openAppHomeTab, openModalFrom } from './support/app-home';

// Home → Time & Billing.
const TIME_AND_BILLING_TAB = [AdminNavigationActionId.ManageTimeAndBilling];

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
      await openAppHomeTab(t, workspace, user, TIME_AND_BILLING_TAB),
      AdminNavigationActionId.ManageBillingReports,
    );

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

    const response = await t.slack
      .submitView(workspace, admin, form, {
        clientId: acme.id,
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
      })
      .expect(200);

    expect(response.body.response_action).toBe('push');
    expect(sectionTexts(response.body.view as View)).toEqual([
      '*Acme* · Oct 1, 2026 – Oct 31, 2026\nApproved: *3h 45m*, billable *3h 15m*\n_Not approved yet: 1h_',
      '*By project*\n• Website — 3h 15m (billable 3h 15m)\n• Support — 30m (billable 0h)',
      '*By person*\n• Mia Member — 2h 45m\n• Ann Admin — 1h',
    ]);
  });

  // The database answers a query with 1000 rows at most and says nothing
  // about the rest.
  it('counts more entries than one answer of the database holds', async () => {
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

    const response = await t.slack
      .submitView(workspace, admin, form, {
        clientId: acme.id,
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
      })
      .expect(200);

    expect(sectionTexts(response.body.view)).toEqual([
      '*Acme* · Oct 1, 2026 – Oct 31, 2026\nApproved: *250h 15m*, billable *250h 15m*',
      '*By project*\n• Website — 250h 15m (billable 250h 15m)',
      '*By person*\n• Mia Member — 250h 15m',
    ]);
  });

  it('says when nothing was approved', async () => {
    await approved(member, website, { status: TimeEntryStatus.Draft });
    const form = await openReportForm();

    const response = await t.slack
      .submitView(workspace, admin, form, {
        clientId: acme.id,
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
      })
      .expect(200);

    expect(sectionTexts(response.body.view)).toEqual([
      '*Acme* · Oct 1, 2026 – Oct 31, 2026\nApproved: *0h*, billable *0h*\n_Not approved yet: 1h_',
      '_No approved time for this client in this period._',
    ]);
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

  it('is for Admin and HR only', async () => {
    const manager = await workspace.addUser({ role: UserRole.Manager });
    const timeAndBilling = await openAppHomeTab(
      t,
      workspace,
      manager,
      TIME_AND_BILLING_TAB,
    );
    expect(actionIdsOf(timeAndBilling)).not.toContain(
      AdminNavigationActionId.ManageBillingReports,
    );

    const response = await t.slack
      .submitView(workspace, manager, await openReportForm(), {
        clientId: acme.id,
      })
      .expect(200);

    expect(response.body.view.title.text).toBe('Forbidden');
  });
});
