import { ModalView, View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { BillingSnapshotsTabActionId } from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';
import { TimeEntriesTabViewActionId } from '@modules/slack/tabs/time-tracking/enums/time-entries-tab-view-action-id.enums';
import { NO_FILES_PERMISSION } from '@modules/slack/common/services/dm-file.service';
import { BILLED_ENTRY_MESSAGE } from 'src/time-entries/constants/billed-time-entries';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { PERIOD_PRESET_ACTION_ID } from '@modules/slack/tabs/reports/views/period-fields';
import { createTestApp, ITestApp } from './support/test-app';
import { findAction } from './support/block-kit';
import { TestWorkspace } from './support/test-workspace';
import {
  actionIdsOf,
  listItems,
  modalError,
  noticeOf,
  sectionTexts,
  tableRows,
  titlesOf,
} from './support/tab-readers';
import {
  actOnTab,
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

const REPORTS_TAB = [NavigationActionId.Reports];
const SNAPSHOTS_TAB = [
  NavigationActionId.Reports,
  NavigationActionId.BillingSnapshots,
];
const TIME_LOGS_TAB = [NavigationActionId.Reports, NavigationActionId.TimeLogs];

// June 2026; today is Wednesday 2026-06-17 (TEST_NOW).
const JUNE = { fromDate: '2026-06-01', toDate: '2026-06-30' };

const LOCK_MESSAGE =
  "*Acme* · 1–30 Jun 2026: the approved time that isn't in a snapshot yet.\n" +
  '• 3 entries, *3h*, billable *2h*\n' +
  "• Amount: *$225.00* at today's rates, kept with the snapshot\n" +
  'Nobody can change these entries until an admin unlocks the snapshot.';

// The lines of a CSV file the app sent, without its byte order mark.
const csvLines = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n$/, '')
    .split('\r\n');

const option = (value: string) => ({
  text: { type: 'plain_text', text: value },
  value,
});

describe('Billing snapshots', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let hr: Tables<'users'>;
  let finance: Tables<'users'>;
  let manager: Tables<'users'>;
  let mia: Tables<'users'>;
  let backend: Tables<'teams'>;
  let acme: Tables<'clients'>;
  let website: Tables<'projects'>;
  let support: Tables<'projects'>;
  // Acme's approved time of June: 3h, of it 2h billable, $225.00.
  let june: Tables<'time_entries'>[];

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
    hr = await workspace.addUser({ role: UserRole.HR, name: 'Hana HR' });
    finance = await workspace.addUser({
      role: UserRole.Finance,
      name: 'Fay Finance',
    });
    manager = await workspace.addUser({
      role: UserRole.Manager,
      name: 'Max Manager',
    });
    backend = await workspace.addTeam({
      name: 'Backend',
      manager_approvers: [manager.slack_id],
    });
    mia = await workspace.addUser({ name: 'Mia Member', team_id: backend.id });
    acme = await workspace.addClient({ name: 'Acme' });
    website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
      hourly_rate: 100,
    });
    support = await workspace.addProject({
      name: 'Support',
      client_id: acme.id,
      billable: false,
    });
    await workspace.addPersonRate(website, admin, 150);

    june = [
      await approved(mia, website, {
        minutes: 90,
        description: 'API review, part 1',
      }),
      await approved(admin, website, { work_date: '2026-06-03', minutes: 30 }),
      await approved(mia, support, {
        work_date: '2026-06-12',
        minutes: 60,
        billable: false,
        description: '=HYPERLINK("http://evil.example")',
      }),
    ];
    // Not taken: not approved yet, another month, deleted.
    await approved(mia, website, { status: TimeEntryStatus.Submitted });
    await approved(mia, website, { work_date: '2026-05-29' });
    await approved(mia, website, {
      deleted_at: new Date().toISOString(),
      deleted_by: admin.id,
    });
  });

  function approved(
    user: Tables<'users'>,
    project: Tables<'projects'>,
    fields: Partial<Tables<'time_entries'>> = {},
  ) {
    return workspace.addTimeEntry(user, project, {
      status: TimeEntryStatus.Approved,
      work_date: '2026-06-10',
      ...fields,
    });
  }

  // Reports with Acme's billing report of `period` on show.
  const showBillingReport = async (user = admin, period = JUNE) => {
    const form = await openModalFrom(
      t,
      workspace,
      user,
      await openAppHomeTab(t, workspace, user, REPORTS_TAB),
      ReportsTabActionId.BillingReport,
    );
    const since = t.slackApi.mark();

    await t.slack
      .submitView(workspace, user, form, { clientId: acme.id, ...period })
      .expect(200);

    return publishedHome(t, workspace, user, since);
  };

  const openLockForm = async (user = admin, period = JUNE) =>
    openModalFrom(
      t,
      workspace,
      user,
      await showBillingReport(user, period),
      ReportsTabActionId.LockSnapshot,
    );

  // Locks Acme's billing report of `period`: the form's answer and the tab
  // the app shows next.
  const lock = async (user = admin, period = JUNE) => {
    const form = await openLockForm(user, period);
    const since = t.slackApi.mark();
    const response = await t.slack
      .submitView(workspace, user, form, {})
      .expect(200);

    return {
      form,
      response,
      tab:
        response.body.response_action === 'clear'
          ? await publishedHome(t, workspace, user, since)
          : undefined,
    };
  };

  const snapshotRows = () => workspace.rows('billing_snapshots');

  // An action in `view` with `action` as the user's choice, as a client
  // could send it whatever the view offered.
  const forge = async (
    user: Tables<'users'>,
    view: View,
    action: Record<string, unknown>,
    target = workspace,
  ) => {
    await t.slack.interaction({
      type: 'block_actions',
      team: { id: target.slackId },
      user: { id: user.slack_id, team_id: target.slackId },
      trigger_id: 'trigger-forged',
      container: { type: 'view' },
      view: { team_id: target.slackId, ...view },
      actions: [{ block_id: 'forged', action_ts: '1', ...action }],
    });
    await t.idle();
  };

  const menu = (actionId: string, value: string) => ({
    type: 'overflow',
    action_id: actionId,
    selected_option: option(value),
  });

  const button = (actionId: string) => ({
    type: 'button',
    action_id: actionId,
  });

  // Chooses a quick period in a report form: the form the app puts in its
  // place (views.update).
  const choosePreset = async (
    user: Tables<'users'>,
    form: View,
    preset: string,
  ) => {
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(workspace, user, form, PERIOD_PRESET_ACTION_ID, preset)
      .expect(200);
    await t.idle();

    return t.slackApi.updatedModal(workspace.token, { since });
  };

  // The initial dates of a form's From and To.
  const datesOf = (form: View) =>
    ['fromDate', 'toDate'].map(
      (actionId) => findAction(form.blocks, actionId).element.initial_date,
    );

  const openedModals = (since: number) =>
    t.slackApi.callsWith(workspace.token, 'views.open', { since });

  describe('locking time', () => {
    it("locks a billing report's approved time with today's rates", async () => {
      const reports = await showBillingReport();

      expect(actionIdsOf(reports)).toContain(ReportsTabActionId.LockSnapshot);

      const { form, response, tab } = await lock();

      expect(form.callback_id).toBe(ViewCallbackId.CreateBillingSnapshot);
      expect(sectionTexts(form)).toEqual([LOCK_MESSAGE]);
      expect(response.body).toEqual({ response_action: 'clear' });
      expect(noticeOf(tab!)).toBe(
        '🔒 Acme · 1–30 Jun 2026 locked: 3 entries, 3h, $225.00.',
      );
      expect(listItems(tab!)).toEqual([
        expect.objectContaining({
          title: 'Acme · 1–30 Jun 2026',
          fields: {
            Time: '3h',
            Billable: '2h',
            Amount: '$225.00',
            Entries: '3',
            Status: '🔒 Locked, not invoiced yet',
            Created: '17 Jun 2026 by Ann Admin',
          },
          menuLabels: ['Send CSV to my DMs', 'Mark as invoiced', 'Unlock'],
        }),
      ]);

      const [snapshot] = await snapshotRows();

      expect(snapshot).toMatchObject({
        client_id: acme.id,
        period_start: '2026-06-01',
        period_end: '2026-06-30',
        currency: 'USD',
        total_minutes: 180,
        billable_minutes: 120,
        total_amount: 225,
        created_by: admin.id,
        invoiced_at: null,
      });
      expect(
        (await workspace.rows('billing_snapshot_entries'))
          .map(({ time_entry_id, minutes, billable, hourly_rate, amount }) => ({
            time_entry_id,
            minutes,
            billable,
            hourly_rate,
            amount,
          }))
          .sort((a, b) => b.minutes - a.minutes),
      ).toEqual([
        {
          time_entry_id: june[0].id,
          minutes: 90,
          billable: true,
          hourly_rate: 100,
          amount: 150,
        },
        {
          time_entry_id: june[2].id,
          minutes: 60,
          billable: false,
          hourly_rate: null,
          amount: null,
        },
        {
          time_entry_id: june[1].id,
          minutes: 30,
          billable: true,
          hourly_rate: 150,
          amount: 75,
        },
      ]);
    });

    it('says in the billing report what is locked, and offers the rest', async () => {
      await lock();

      let reports = await showBillingReport();

      expect(sectionTexts(reports)).toContain(
        '*Billing report: Acme* · 1–30 Jun 2026\nApproved: *3h*, billable *2h* · Amount: *$225.00*\n_Not approved yet: 1h_\n_In billing snapshots already: 3h of the approved time_',
      );
      expect(actionIdsOf(reports)).not.toContain(
        ReportsTabActionId.LockSnapshot,
      );

      // Approved since: a second snapshot of June takes only that.
      await approved(mia, website, { work_date: '2026-06-16', minutes: 45 });
      reports = await showBillingReport();
      expect(actionIdsOf(reports)).toContain(ReportsTabActionId.LockSnapshot);

      const { tab } = await lock();

      expect(noticeOf(tab!)).toBe(
        '🔒 Acme · 1–30 Jun 2026 locked: 1 entry, 45m, $75.00.',
      );
      expect(
        (await snapshotRows()).map(({ total_minutes }) => total_minutes).sort(),
      ).toEqual([180, 45]);
    });

    it('refuses a period with nothing left outside snapshots', async () => {
      const { form } = await lock();

      // The same form again: its time is locked now.
      const response = await t.slack
        .submitView(workspace, admin, form, {})
        .expect(200);

      expect(modalError(response.body.view)).toBe(
        'No approved time of Acme in 1–30 Jun 2026 is left outside snapshots.',
      );
      expect(await snapshotRows()).toHaveLength(1);
    });

    it('is made by Finance too', async () => {
      const { tab } = await lock(finance);

      expect(listItems(tab!)[0]).toMatchObject({
        fields: expect.objectContaining({
          Created: '17 Jun 2026 by Fay Finance',
        }),
        // Unlocking is an admin's.
        menuLabels: ['Send CSV to my DMs', 'Mark as invoiced'],
      });
    });

    it('is not made by a manager or a member, whatever they send', async () => {
      const adminForm = await openLockForm();

      for (const user of [manager, mia]) {
        const reports = await openAppHomeTab(t, workspace, user, REPORTS_TAB);
        const since = t.slackApi.mark();

        expect(actionIdsOf(reports)).not.toContain(
          ReportsTabActionId.BillingReport,
        );
        await forge(
          user,
          {
            ...reports,
            private_metadata: JSON.stringify({
              report: { clientId: acme.id, ...JUNE },
            }),
          },
          button(ReportsTabActionId.LockSnapshot),
        );
        expect(openedModals(since)).toHaveLength(0);

        // The form an admin got, sent as theirs.
        const response = await t.slack
          .submitView(workspace, user, adminForm, {})
          .expect(200);

        expect(response.body.response_action).toBe('update');
      }

      expect(await snapshotRows()).toEqual([]);
    });

    it("refuses another workspace's client in the form", async () => {
      const other = await t.createWorkspace();
      const theirs = await other.addClient({ name: 'Theirs' });
      const form = await openLockForm();

      const response = await t.slack
        .submitView(
          workspace,
          admin,
          {
            ...form,
            private_metadata: JSON.stringify({
              id: theirs.id,
              pageMetadata: JSON.stringify({
                report: { clientId: theirs.id, ...JUNE },
              }),
            }),
          },
          {},
        )
        .expect(200);

      expect(modalError(response.body.view)).toBe('Client not found.');
      expect(await snapshotRows()).toEqual([]);
    });
  });

  describe('working after the answer', () => {
    // The ID and hash Slack gave a modal the app opened.
    const idOf = (view: View) => (view as View & { id: string }).id;
    const hashOf = (view: View) => (view as View & { hash: string }).hash;
    // A modal's button that confirms, if it has one.
    const submitOf = (view: View) => (view as ModalView).submit;

    // The statements sent since `mark` that someone waited for before the
    // answer, and those that ran after it.
    const statementsSince = (mark: number) => {
      const statements = t.sql.statements(mark);

      return {
        answer: statements.filter(({ background }) => !background),
        after: statements.filter(({ background }) => background),
      };
    };

    it('opens the confirmation at once and adds up what it locks after the answer', async () => {
      const reports = await showBillingReport();
      const mark = t.sql.mark();
      const since = t.slackApi.mark();

      await t.slack
        .actOnView(workspace, admin, reports, ReportsTabActionId.LockSnapshot)
        .expect(200);
      await t.idle();

      const opened = t.slackApi.openedModal(workspace.token, { since });
      const [update] = t.slackApi.callsWith(workspace.token, 'views.update', {
        since,
      });
      const shown = t.slackApi.updatedModal(workspace.token, { since });

      // Nothing to confirm yet.
      expect(sectionTexts(opened)).toEqual([
        "⏳ Adding up the approved time that isn't in a snapshot yet…",
      ]);
      expect(submitOf(opened)).toBeUndefined();
      // The same modal, as views.open left it.
      expect(update.params).toMatchObject({
        view_id: idOf(opened),
        hash: hashOf(opened),
      });
      expect(shown.callback_id).toBe(ViewCallbackId.CreateBillingSnapshot);
      expect(sectionTexts(shown)).toEqual([LOCK_MESSAGE]);

      const { answer, after } = statementsSince(mark);

      expect(
        answer.filter(({ text }) => text.includes('time_entries')),
      ).toEqual([]);
      expect(after.some(({ text }) => text.includes('time_entries'))).toBe(
        true,
      );
    });

    it("says in the confirmation when what it locks can't be added up", async () => {
      const other = await t.createWorkspace();
      const theirs = await other.addClient({ name: 'Theirs' });
      const reports = await showBillingReport();
      const since = t.slackApi.mark();

      await forge(
        admin,
        {
          ...reports,
          private_metadata: JSON.stringify({
            report: { clientId: theirs.id, ...JUNE },
          }),
        },
        button(ReportsTabActionId.LockSnapshot),
      );

      const shown = t.slackApi.updatedModal(workspace.token, { since });

      expect(modalError(shown)).toBe('Client not found.');
      expect(submitOf(shown)).toBeUndefined();
    });
  });

  describe('locked entries', () => {
    // Mia's 1h 30m on Website, in Time logs.
    const timeLogItem = async () => {
      const logs = await openAppHomeTab(t, workspace, admin, TIME_LOGS_TAB);

      return {
        logs,
        item: listItems(logs).find(
          ({ fields }) => fields.Description === 'API review, part 1',
        ),
      };
    };

    it('show as billed, with nothing to change in Time logs', async () => {
      expect((await timeLogItem()).item?.menu).toEqual([
        TimeEntriesTabViewActionId.EditTimeEntry,
        TimeEntriesTabViewActionId.DeleteTimeEntry,
      ]);

      await lock();

      const { item } = await timeLogItem();

      expect(item?.fields.Billing).toBe('🔒 In a billing snapshot');
      expect(item?.menu).toEqual([]);
    });

    it("can't be edited, un-approved or deleted, by an admin either", async () => {
      const [entry] = june;
      const { logs } = await timeLogItem();
      // Opened before the snapshot locked the entry.
      const edit = await openModalFrom(
        t,
        workspace,
        admin,
        logs,
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${TimeEntriesTabViewActionId.EditTimeEntry}:${entry.id}`,
      );
      const remove = await openModalFrom(
        t,
        workspace,
        admin,
        logs,
        TimeEntriesTabViewActionId.ManageTimeEntryMenu,
        `${TimeEntriesTabViewActionId.DeleteTimeEntry}:${entry.id}`,
      );

      await lock();

      for (const values of [
        { hours: '2' },
        { status: TimeEntryStatus.Draft },
      ]) {
        const response = await t.slack
          .submitView(workspace, admin, edit, values)
          .expect(200);

        expect(modalError(response.body.view)).toBe(BILLED_ENTRY_MESSAGE);
      }

      const deleted = await t.slack
        .submitView(workspace, admin, remove, {})
        .expect(200);

      expect(modalError(deleted.body.view)).toBe(BILLED_ENTRY_MESSAGE);
      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        minutes: 90,
        status: TimeEntryStatus.Approved,
        deleted_at: null,
      });
    });

    it('are refused by the database whatever writes them', async () => {
      const [entry] = june;

      await lock();

      for (const change of [
        { minutes: 30 },
        { status: TimeEntryStatus.Rejected },
        { deleted_at: new Date().toISOString() },
        { description: 'Changed' },
      ]) {
        await expect(
          t.db
            .updateTable('time_entries')
            .set(change)
            .where('id', '=', entry.id)
            .execute(),
        ).rejects.toMatchObject({ code: 'LB001' });
      }

      await expect(
        t.db.deleteFrom('time_entries').where('id', '=', entry.id).execute(),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('stay when their team is deleted, without a team', async () => {
      const [entry] = june;

      await lock();
      await t.db
        .updateTable('users')
        .set({ team_id: null })
        .where('id', '=', mia.id)
        .execute();
      await t.db.deleteFrom('teams').where('id', '=', backend.id).execute();

      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        team_id: null,
        minutes: 90,
      });
    });
  });

  describe('invoicing and unlocking', () => {
    const openSnapshots = (user = admin) =>
      openAppHomeTab(t, workspace, user, SNAPSHOTS_TAB);

    const snapshotId = async () => (await snapshotRows())[0].id;

    const openMenuModal = async (
      user: Tables<'users'>,
      action: BillingSnapshotsTabActionId,
    ) =>
      openModalFrom(
        t,
        workspace,
        user,
        await openSnapshots(user),
        BillingSnapshotsTabActionId.ManageSnapshotMenu,
        `${action}:${await snapshotId()}`,
      );

    const submit = async (user: Tables<'users'>, form: View) => {
      const since = t.slackApi.mark();
      const response = await t.slack
        .submitView(workspace, user, form, {})
        .expect(200);

      return {
        response,
        tab:
          response.body.response_action === 'clear'
            ? await publishedHome(t, workspace, user, since)
            : undefined,
      };
    };

    beforeEach(async () => {
      await lock();
    });

    it('lets Finance mark a snapshot invoiced, once', async () => {
      const form = await openMenuModal(
        finance,
        BillingSnapshotsTabActionId.MarkInvoiced,
      );

      expect(sectionTexts(form)).toEqual([
        'The snapshot *Acme · 1–30 Jun 2026* (*$225.00*) will be marked invoiced. It stays locked.',
      ]);

      const { tab } = await submit(finance, form);

      expect(noticeOf(tab!)).toBe('✅ Acme · 1–30 Jun 2026 marked invoiced.');
      expect(listItems(tab!)[0]).toMatchObject({
        fields: expect.objectContaining({
          Status: '✅ Invoiced 17 Jun 2026 by Fay Finance',
        }),
        menuLabels: ['Send CSV to my DMs', 'Mark as not invoiced'],
      });

      // The same form again.
      const again = await submit(finance, form);

      expect(modalError(again.response.body.view)).toBe(
        'This snapshot is already marked invoiced.',
      );
    });

    it('lets Finance take the invoiced mark off again', async () => {
      await submit(
        finance,
        await openMenuModal(finance, BillingSnapshotsTabActionId.MarkInvoiced),
      );

      const form = await openMenuModal(
        finance,
        BillingSnapshotsTabActionId.MarkNotInvoiced,
      );

      expect(sectionTexts(form)).toEqual([
        'The snapshot *Acme · 1–30 Jun 2026* will no longer be marked invoiced. It stays locked, and its time counts as uninvoiced again.',
      ]);

      const { tab } = await submit(finance, form);

      expect(noticeOf(tab!)).toBe(
        '↩️ Acme · 1–30 Jun 2026 is no longer marked invoiced.',
      );
      expect(listItems(tab!)[0]).toMatchObject({
        fields: expect.objectContaining({
          Status: '🔒 Locked, not invoiced yet',
        }),
        menuLabels: ['Send CSV to my DMs', 'Mark as invoiced'],
      });
      expect(await snapshotRows()).toEqual([
        expect.objectContaining({ invoiced_at: null, invoiced_by: null }),
      ]);

      const again = await submit(finance, form);

      expect(modalError(again.response.body.view)).toBe(
        "This snapshot isn't marked invoiced.",
      );
    });

    it('filters the list by client', async () => {
      const globex = await workspace.addClient({ name: 'Globex' });
      const other = await t.createWorkspace();
      const theirs = await other.addClient({ name: 'Theirs' });

      await t.db
        .insertInto('billing_snapshots')
        .values({
          slack_team_id: workspace.id,
          client_id: globex.id,
          period_start: '2026-05-01',
          period_end: '2026-05-31',
          currency: 'USD',
          total_minutes: 60,
          billable_minutes: 60,
          total_amount: 100,
          created_at: '2026-06-01T09:00:00Z',
        })
        .execute();

      const all = await openSnapshots();

      expect(titlesOf(all)).toEqual([
        'Acme · 1–30 Jun 2026',
        'Globex · 1–31 May 2026',
      ]);

      const globexOnly = await actOnTab(
        t,
        workspace,
        admin,
        all,
        BillingSnapshotsTabActionId.FilterByClient,
        globex.id,
      );

      expect(titlesOf(globexOnly)).toEqual(['Globex · 1–31 May 2026']);

      // Another workspace's client, as a client could send it.
      await forge(admin, globexOnly, {
        type: 'static_select',
        action_id: BillingSnapshotsTabActionId.FilterByClient,
        selected_option: option(theirs.id),
      });

      expect(
        titlesOf(t.slackApi.homeView(workspace.token, admin.slack_id)),
      ).toEqual([]);

      const again = await actOnTab(
        t,
        workspace,
        admin,
        globexOnly,
        BillingSnapshotsTabActionId.FilterByClient,
        'all',
      );

      expect(titlesOf(again)).toHaveLength(2);
    });

    it('lets an admin unlock a snapshot, which frees its entries', async () => {
      const form = await openMenuModal(
        admin,
        BillingSnapshotsTabActionId.UnlockSnapshot,
      );

      expect(sectionTexts(form)).toEqual([
        'The snapshot *Acme · 1–30 Jun 2026* will be deleted. Its 3 entries can be changed again, and count as uninvoiced until another snapshot takes them.',
      ]);

      const { tab } = await submit(admin, form);

      expect(noticeOf(tab!)).toBe(
        '🔓 Acme · 1–30 Jun 2026 unlocked: its 3 entries can be changed again.',
      );
      expect(listItems(tab!)).toEqual([]);
      expect(await workspace.rows('billing_snapshot_entries')).toEqual([]);

      await t.db
        .updateTable('time_entries')
        .set({ minutes: 60 })
        .where('id', '=', june[0].id)
        .execute();
      expect(actionIdsOf(await showBillingReport())).toContain(
        ReportsTabActionId.LockSnapshot,
      );
    });

    it('warns before unlocking an invoiced snapshot', async () => {
      await submit(
        admin,
        await openMenuModal(admin, BillingSnapshotsTabActionId.MarkInvoiced),
      );

      const form = await openMenuModal(
        admin,
        BillingSnapshotsTabActionId.UnlockSnapshot,
      );

      expect(sectionTexts(form)).toEqual([
        "The snapshot *Acme · 1–30 Jun 2026* will be deleted. Its 3 entries can be changed again, and count as uninvoiced until another snapshot takes them.\n\n⚠️ It was marked invoiced on 17 Jun 2026. If its time changes, it won't match the invoice.",
      ]);

      await submit(admin, form);

      expect(await snapshotRows()).toEqual([]);
    });

    it('is not unlocked by Finance, whatever they send', async () => {
      const adminForm = await openMenuModal(
        admin,
        BillingSnapshotsTabActionId.UnlockSnapshot,
      );
      const since = t.slackApi.mark();

      await forge(
        finance,
        await openSnapshots(finance),
        menu(
          BillingSnapshotsTabActionId.ManageSnapshotMenu,
          `${BillingSnapshotsTabActionId.UnlockSnapshot}:${await snapshotId()}`,
        ),
      );
      expect(openedModals(since)).toHaveLength(0);

      const response = await t.slack
        .submitView(workspace, finance, adminForm, {})
        .expect(200);

      expect(response.body.response_action).toBe('update');
      expect(await snapshotRows()).toHaveLength(1);
    });

    it.each(['manager', 'hr'] as const)(
      'is out of reach of a %s',
      async (role) => {
        const viewer = { manager, hr }[role];
        const id = await snapshotId();
        const snapshots = await openSnapshots();
        const since = t.slackApi.mark();

        for (const action of [
          BillingSnapshotsTabActionId.ExportSnapshot,
          BillingSnapshotsTabActionId.MarkInvoiced,
          BillingSnapshotsTabActionId.MarkNotInvoiced,
          BillingSnapshotsTabActionId.UnlockSnapshot,
        ]) {
          await forge(
            viewer,
            snapshots,
            menu(
              BillingSnapshotsTabActionId.ManageSnapshotMenu,
              `${action}:${id}`,
            ),
          );
        }

        expect(openedModals(since)).toHaveLength(0);
        expect(
          t.slackApi.callsWith(workspace.token, 'chat.postMessage', { since }),
        ).toEqual([]);
        expect(await snapshotRows()).toEqual([
          expect.objectContaining({ id, invoiced_at: null }),
        ]);
      },
    );

    it("leaves another workspace's snapshot alone", async () => {
      const other = await t.createWorkspace();
      const otherAdmin = await other.addUser({ role: UserRole.Admin });
      const id = await snapshotId();
      const since = t.slackApi.mark();

      for (const action of [
        BillingSnapshotsTabActionId.ExportSnapshot,
        BillingSnapshotsTabActionId.MarkInvoiced,
        BillingSnapshotsTabActionId.UnlockSnapshot,
      ]) {
        await forge(
          otherAdmin,
          await openAppHomeTab(t, other, otherAdmin, SNAPSHOTS_TAB),
          menu(
            BillingSnapshotsTabActionId.ManageSnapshotMenu,
            `${action}:${id}`,
          ),
          other,
        );
      }

      expect(
        t.slackApi.callsWith(other.token, 'views.open', { since }),
      ).toEqual([]);
      expect(
        t.slackApi.callsWith(other.token, 'files.completeUploadExternal', {
          since,
        }),
      ).toEqual([]);
      expect(await snapshotRows()).toEqual([
        expect.objectContaining({ id, invoiced_at: null }),
      ]);
    });
  });

  describe('CSV', () => {
    // The DM channel of a user, as Slack answers a message to their user ID.
    const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

    const exportSnapshot = async (user = admin) => {
      const snapshots = await openAppHomeTab(t, workspace, user, SNAPSHOTS_TAB);
      const since = t.slackApi.mark();
      const after = await actOnTab(
        t,
        workspace,
        user,
        snapshots,
        BillingSnapshotsTabActionId.ManageSnapshotMenu,
        `${BillingSnapshotsTabActionId.ExportSnapshot}:${(await snapshotRows())[0].id}`,
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

    it('sends the entries with the rates the snapshot froze', async () => {
      await lock();
      // Today's rates change; the snapshot keeps its own.
      await t.db
        .updateTable('projects')
        .set({ hourly_rate: 200 })
        .where('id', '=', website.id)
        .execute();
      await t.db
        .deleteFrom('project_user_rates')
        .where('project_id', '=', website.id)
        .execute();

      const { after, messages, files } = await exportSnapshot(finance);

      expect(noticeOf(after)).toBe('📨 Sending the CSV to your DMs.');
      expect(messages.map(({ text }) => text)).toEqual([
        '📄 Billing snapshot, Acme, 1–30 Jun 2026: 3 entries, 3h, $225.00.',
      ]);
      expect(files).toHaveLength(1);
      expect(files[0]).toMatchObject({
        filename: 'billing-acme-2026-06-01-to-2026-06-30.csv',
        title: 'Billing snapshot, Acme, 1–30 Jun 2026',
      });
      expect(csvLines(files[0].content)).toEqual([
        'Date,Person,Email,Team,Project,Description,Hours,Billable,Rate,Amount,Currency',
        `2026-06-03,Ann Admin,${admin.email},,Website,,0.50,yes,150.00,75.00,USD`,
        `2026-06-10,Mia Member,${mia.email},Backend,Website,"API review, part 1",1.50,yes,100.00,150.00,USD`,
        `2026-06-12,Mia Member,${mia.email},Backend,Support,"'=HYPERLINK(""http://evil.example"")",1.00,no,,,USD`,
      ]);
    });

    it('asks for a reinstall when the workspace has not granted files:write', async () => {
      await lock();
      t.slackApi.failNext('files.completeUploadExternal', 1, 'missing_scope');

      const { messages, files } = await exportSnapshot();

      expect(files).toEqual([]);
      expect(
        t.slackApi
          .messageUpdates(workspace.token, messages[0])
          .map(({ text }) => text),
      ).toEqual([
        `📄 Billing snapshot, Acme, 1–30 Jun 2026: 3 entries, 3h, $225.00.\n${NO_FILES_PERMISSION}`,
      ]);
    });
  });

  describe('uninvoiced report', () => {
    // Opens the form from Reports, sends it with `period` (no dates: all
    // time) and returns Reports.
    const showUninvoiced = async (
      user = admin,
      period: { fromDate?: string; toDate?: string } = {},
    ) => {
      const form = await openModalFrom(
        t,
        workspace,
        user,
        await openAppHomeTab(t, workspace, user, REPORTS_TAB),
        ReportsTabActionId.Uninvoiced,
      );
      const since = t.slackApi.mark();

      await t.slack.submitView(workspace, user, form, period).expect(200);

      return publishedHome(t, workspace, user, since);
    };

    const reportTexts = (view: View) =>
      sectionTexts(view).filter((text) => text.startsWith('*Uninvoiced time*'));

    it('shows per client the time in no snapshot and in snapshots not invoiced', async () => {
      const globex = await workspace.addClient({ name: 'Globex' });
      const shop = await workspace.addProject({
        name: 'Shop',
        client_id: globex.id,
        hourly_rate: 50,
      });
      const unrated = await workspace.addProject({
        name: 'Research',
        client_id: globex.id,
      });
      const inhouse = await workspace.addProject({ name: 'In-house' });

      await approved(mia, shop, { work_date: '2026-05-04', minutes: 120 });
      await approved(mia, unrated, { work_date: '2026-06-01', minutes: 30 });
      // Neither billable, nor approved, nor anyone's to bill.
      await approved(mia, shop, { billable: false });
      await approved(mia, shop, { status: TimeEntryStatus.Draft });
      await approved(mia, inhouse);

      await lock();
      // Approved after the snapshot was made.
      await approved(mia, website, { work_date: '2026-06-16', minutes: 45 });

      const reports = await showUninvoiced(finance);

      expect(reportTexts(reports)).toEqual([
        "*Uninvoiced time* · All time · Approved billable time that isn't invoiced yet\n" +
          "Not in a snapshot: *4h 15m*, *$275.00* at today's rates\n" +
          'In snapshots not marked invoiced: *2h*, *$225.00*\n' +
          '_No rate: 30m of billable time, not in the amounts_',
      ]);
      expect(tableRows(reports)).toEqual([
        [
          'Client',
          'Not in a snapshot',
          'Amount',
          'Since',
          'In snapshots',
          'Snapshot amount',
        ],
        ['Globex', '2h 30m', '$100.00', '4 May 2026', '0h', '$0.00'],
        ['Acme', '1h 45m', '$175.00', '29 May 2026', '2h', '$225.00'],
        ['Total', '4h 15m', '$275.00', '–', '2h', '$225.00'],
      ]);

      // Once invoiced, the snapshot's time is off the report.
      await t.db
        .updateTable('billing_snapshots')
        .set({ invoiced_at: new Date().toISOString() })
        .where('slack_team_id', '=', workspace.id)
        .execute();

      expect(tableRows(await showUninvoiced())[2]).toEqual([
        'Acme',
        '1h 45m',
        '$175.00',
        '29 May 2026',
        '0h',
        '$0.00',
      ]);
    });

    it('says when nothing is left to invoice', async () => {
      await lock();
      await t.db
        .updateTable('time_entries')
        .set({ billable: false })
        .where('work_date', '=', '2026-05-29')
        .where('slack_team_id', '=', workspace.id)
        .execute();
      await t.db
        .updateTable('billing_snapshots')
        .set({ invoiced_at: new Date().toISOString() })
        .where('slack_team_id', '=', workspace.id)
        .execute();

      const reports = await showUninvoiced();

      expect(sectionTexts(reports)).toContain(
        "*Uninvoiced time* · All time · Approved billable time that isn't invoiced yet\nNot in a snapshot: *0h*, *$0.00* at today's rates\nIn snapshots not marked invoiced: *0h*, *$0.00*",
      );
      expect(tableRows(reports)).toEqual([]);
    });

    it('is not shown to managers or members, whatever they send', async () => {
      for (const user of [manager, mia]) {
        const reports = await openAppHomeTab(t, workspace, user, REPORTS_TAB);

        expect(actionIdsOf(reports)).not.toContain(
          ReportsTabActionId.Uninvoiced,
        );
        expect(actionIdsOf(reports)).not.toContain(
          NavigationActionId.BillingSnapshots,
        );

        const since = t.slackApi.mark();

        await forge(user, reports, button(ReportsTabActionId.Uninvoiced));
        // Nor through the metadata of a view they act on: the export keeps
        // it as the tab's.
        await forge(
          user,
          {
            ...reports,
            private_metadata: JSON.stringify({
              uninvoiced: {},
              timeReport: { kind: 'project', ...JUNE },
            }),
          },
          button(ReportsTabActionId.ExportTimeReport),
        );

        const published = t.slackApi
          .callsWith(workspace.token, 'views.publish', { since })
          .map(({ params }) => params.view as View);

        // The export re-rendered Reports, without the uninvoiced report.
        expect(published.length).toBeGreaterThan(0);
        expect(published.flatMap(reportTexts)).toEqual([]);
        expect(openedModals(since)).toEqual([]);
      }

      // The form an admin got, sent as a manager's.
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, REPORTS_TAB),
        ReportsTabActionId.Uninvoiced,
      );
      const response = await t.slack
        .submitView(workspace, manager, form, {})
        .expect(200);

      expect(response.body.response_action).toBe('update');
    });

    it('covers a period, with a quick period or dates', async () => {
      await approved(mia, website, { work_date: '2026-05-04', minutes: 30 });
      await lock(admin, { fromDate: '2026-06-01', toDate: '2026-06-10' });

      // May: the 29th's hour and the 4th's 30m, nothing locked.
      const may = await showUninvoiced(admin, {
        fromDate: '2026-05-01',
        toDate: '2026-05-31',
      });

      expect(reportTexts(may)).toEqual([
        "*Uninvoiced time* · 1–31 May 2026 · Approved billable time that isn't invoiced yet\n" +
          "Not in a snapshot: *1h 30m*, *$150.00* at today's rates\n" +
          'In snapshots not marked invoiced: *0h*, *$0.00*',
      ]);
      expect(tableRows(may)[1]).toEqual([
        'Acme',
        '1h 30m',
        '$150.00',
        '4 May 2026',
        '0h',
        '$0.00',
      ]);

      // From June: the snapshot's 2h; open-ended, so "Since".
      const june = await showUninvoiced(admin, { fromDate: '2026-06-01' });

      expect(reportTexts(june)[0]).toMatch(
        /^\*Uninvoiced time\* · Since 1 Jun 2026 · .*\nNot in a snapshot: \*0h\*, \*\$0\.00\* .*\nIn snapshots not marked invoiced: \*2h\*, \*\$225\.00\*$/,
      );

      // A quick period fills the dates; All time empties them.
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, REPORTS_TAB),
        ReportsTabActionId.Uninvoiced,
      );
      const lastMonth = await choosePreset(admin, form, 'last_month');

      expect(datesOf(lastMonth)).toEqual(['2026-05-01', '2026-05-31']);

      const allTime = await choosePreset(admin, lastMonth, 'all_time');

      expect(datesOf(allTime)).toEqual([undefined, undefined]);
    });

    it('refuses an end before the start', async () => {
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, REPORTS_TAB),
        ReportsTabActionId.Uninvoiced,
      );
      const response = await t.slack
        .submitView(workspace, admin, form, {
          fromDate: '2026-06-10',
          toDate: '2026-06-01',
        })
        .expect(200);

      expect(response.body).toEqual({
        response_action: 'errors',
        errors: { to_date_block: 'End date must not be before the start date' },
      });
    });
  });
});
