import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { NO_FILES_PERMISSION } from '@modules/slack/common/services/dm-file.service';
import { ReportsTabActionId } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { BillingSnapshotsTabActionId } from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { noticeOf } from './support/tab-readers';
import {
  openAppHomeTab,
  openModalFrom,
  publishedHome,
} from './support/app-home';

// June 2026; today is Wednesday 2026-06-17 (TEST_NOW).
const JUNE = { fromDate: '2026-06-01', toDate: '2026-06-30' };

const TIME_REPORT_INTRO =
  "📄 Time report, 1–30 Jun 2026 (everyone's time): 2 entries, 3h.";
const SNAPSHOT_INTRO =
  '📄 Billing snapshot, Acme, 1–30 Jun 2026: 2 entries, 3h, $300.00.';

// The CSV of a report or a snapshot is a job (JobsService): an upload that
// fails is retried, a CSV that never goes is told of, and one person's
// export of a report runs once at a time. retryJobs() runs the retries now.
describe('CSV exports', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let acme: Tables<'clients'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => {
    jest.restoreAllMocks();
    // The app outlives a test: a failure one test asked for and didn't use
    // up would fail the next one's calls.
    t.slackApi.failNext('files.getUploadURLExternal', 0);
    t.slackApi.failNext('files.completeUploadExternal', 0);
  });

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin, name: 'Ann' });
    acme = await workspace.addClient({ name: 'Acme' });
    const website = await workspace.addProject({
      name: 'Website',
      client_id: acme.id,
      hourly_rate: 100,
    });

    for (const [workDate, minutes] of [
      ['2026-06-09', 60],
      ['2026-06-10', 120],
    ] as const) {
      await workspace.addTimeEntry(admin, website, {
        status: TimeEntryStatus.Approved,
        work_date: workDate,
        minutes,
        billable: true,
      });
    }
  });

  // The DM channel of a user, as Slack answers a message to their user ID.
  const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

  // The messages Ann still sees in her DM, and the files in it.
  const dmTexts = (since: number) =>
    t.slackApi
      .shownMessages(workspace.token, admin.slack_id, { since })
      .map(({ text }) => text);
  const files = (since: number) =>
    t.slackApi.uploadedFiles(workspace.token, dmOf(admin), { since });

  // Runs the retries until the job gives up (its run in the click, a first
  // saved run and 8 retries), and returns how many rounds that took.
  const retryUntil = async (done: () => boolean) => {
    let rounds = 0;

    while (!done() && rounds < 20) {
      await t.retryJobs();
      rounds += 1;
    }

    return rounds;
  };

  // Uploads wait until the test opens them.
  const holdUploads = () => {
    let open = () => {};
    const opened = new Promise<void>((resolve) => (open = resolve));
    const uploadFile = t.slackApi.uploadFile.bind(t.slackApi);

    jest.spyOn(t.slackApi, 'uploadFile').mockImplementation(async (...args) => {
      await opened;

      return uploadFile(...args);
    });

    return open;
  };

  // The notices of the views published since `since`, sorted.
  const noticesSince = (since: number) =>
    t.slackApi
      .callsWith(workspace.token, 'views.publish', { since })
      .map(({ params }) => noticeOf(params.view as View))
      .sort();

  describe('of a time report', () => {
    const showReport = async () => {
      const form = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, [NavigationActionId.Reports]),
        ReportsTabActionId.TimeReport,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, admin, form, {
          kind: TimeReportKind.Project,
          ...JUNE,
        })
        .expect(200);

      return publishedHome(t, workspace, admin, since);
    };

    const clickExport = (reports: View) =>
      t.slack
        .actOnView(
          workspace,
          admin,
          reports,
          ReportsTabActionId.ExportTimeReport,
        )
        .expect(200);

    it('sends the CSV on a retry when the upload failed, with no message before it', async () => {
      const reports = await showReport();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.getUploadURLExternal');

      await clickExport(reports);
      await t.idle();

      expect(dmTexts(since)).toEqual([]);
      expect(files(since)).toEqual([]);

      await t.retryJobs();

      expect(dmTexts(since)).toEqual([TIME_REPORT_INTRO]);
      expect(files(since)).toEqual([
        expect.objectContaining({
          filename: 'time-report-2026-06-01-to-2026-06-30.csv',
        }),
      ]);
    });

    it('deletes the message of a file it could not share, and sends both on a retry', async () => {
      const reports = await showReport();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.completeUploadExternal');

      await clickExport(reports);
      await t.idle();

      expect(
        t.slackApi.postedMessages(workspace.token, admin.slack_id, { since }),
      ).toHaveLength(1);
      expect(dmTexts(since)).toEqual([]);

      await t.retryJobs();

      expect(dmTexts(since)).toEqual([TIME_REPORT_INTRO]);
      expect(files(since)).toHaveLength(1);
    });

    it('tells the person once the last retry failed', async () => {
      const reports = await showReport();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.getUploadURLExternal', 100);

      await clickExport(reports);
      await t.idle();

      expect(await retryUntil(() => dmTexts(since).length > 0)).toBe(9);
      expect(dmTexts(since)).toEqual([
        "⚠️ I couldn't send the CSV of the time report, 1–30 Jun 2026: sending it kept failing for hours. Show the report on Reports and send the CSV again.",
      ]);
      expect(files(since)).toEqual([]);
    });

    it('makes one file of a double click, and another once it was sent', async () => {
      const reports = await showReport();
      const since = t.slackApi.mark();
      const openUploads = holdUploads();

      await Promise.all([clickExport(reports), clickExport(reports)]);
      openUploads();
      await t.idle();

      expect(noticesSince(since)).toEqual([
        '📨 Sending the CSV to your DMs.',
        '📨 The CSV is already on its way to your DMs.',
      ]);
      expect(dmTexts(since)).toEqual([TIME_REPORT_INTRO]);
      expect(files(since)).toHaveLength(1);

      await clickExport(reports);
      await t.idle();

      expect(files(since)).toHaveLength(2);
    });

    it('asks for a reinstall without files:write, and tries no more', async () => {
      const reports = await showReport();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.getUploadURLExternal', 1, 'missing_scope');

      await clickExport(reports);
      await t.idle();
      const calls = t.slackApi.mark();
      await t.retryJobs();

      expect(dmTexts(since)).toEqual([
        `${TIME_REPORT_INTRO}\n${NO_FILES_PERMISSION}`,
      ]);
      expect(files(since)).toEqual([]);
      expect(t.slackApi.mark()).toBe(calls);
    });
  });

  describe('of a billing snapshot', () => {
    // Locks Acme's June in a snapshot, from its billing report on Reports.
    const lockSnapshot = async () => {
      const billingForm = await openModalFrom(
        t,
        workspace,
        admin,
        await openAppHomeTab(t, workspace, admin, [NavigationActionId.Reports]),
        ReportsTabActionId.BillingReport,
      );
      const since = t.slackApi.mark();

      await t.slack
        .submitView(workspace, admin, billingForm, {
          clientId: acme.id,
          ...JUNE,
        })
        .expect(200);

      const lockForm = await openModalFrom(
        t,
        workspace,
        admin,
        await publishedHome(t, workspace, admin, since),
        ReportsTabActionId.LockSnapshot,
      );

      await t.slack.submitView(workspace, admin, lockForm, {}).expect(200);
      await t.idle();

      const [snapshot] = await workspace.rows('billing_snapshots');

      return snapshot.id;
    };

    const clickExport = async (snapshotId: string) => {
      const snapshots = await openAppHomeTab(t, workspace, admin, [
        NavigationActionId.Reports,
        NavigationActionId.BillingSnapshots,
      ]);

      return () =>
        t.slack
          .actOnView(
            workspace,
            admin,
            snapshots,
            BillingSnapshotsTabActionId.ManageSnapshotMenu,
            `${BillingSnapshotsTabActionId.ExportSnapshot}:${snapshotId}`,
          )
          .expect(200);
    };

    it('sends the CSV on a retry when the upload failed', async () => {
      const click = await clickExport(await lockSnapshot());
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.getUploadURLExternal');

      await click();
      await t.idle();

      expect(dmTexts(since)).toEqual([]);

      await t.retryJobs();

      expect(dmTexts(since)).toEqual([SNAPSHOT_INTRO]);
      expect(files(since)).toEqual([
        expect.objectContaining({
          filename: 'billing-acme-2026-06-01-to-2026-06-30.csv',
        }),
      ]);
    });

    it('tells the person once the last retry failed', async () => {
      const click = await clickExport(await lockSnapshot());
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.completeUploadExternal', 100);

      await click();
      await t.idle();

      expect(await retryUntil(() => dmTexts(since).length > 0)).toBe(9);
      expect(dmTexts(since)).toEqual([
        "⚠️ I couldn't send the CSV of the billing snapshot Acme, 1–30 Jun 2026: sending it kept failing for hours. Send it again from Reports → Billing snapshots.",
      ]);
      expect(files(since)).toEqual([]);
    });

    it('makes one file of a double click', async () => {
      const click = await clickExport(await lockSnapshot());
      const since = t.slackApi.mark();
      const openUploads = holdUploads();

      await Promise.all([click(), click()]);
      openUploads();
      await t.idle();

      expect(noticesSince(since)).toEqual([
        '📨 Sending the CSV to your DMs.',
        '📨 The CSV is already on its way to your DMs.',
      ]);
      expect(dmTexts(since)).toEqual([SNAPSHOT_INTRO]);
      expect(files(since)).toHaveLength(1);
    });
  });
});
