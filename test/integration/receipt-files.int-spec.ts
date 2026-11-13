import { unzipSync } from 'fflate';
import { sql } from 'kysely';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { NO_FILES_PERMISSION } from '@modules/slack/common/services/dm-file.service';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import {
  IReceiptsArchiveLimits,
  RECEIPTS_ARCHIVE_LIMITS,
} from '@modules/receipts/constants/receipts-archive';
import { JOBS_OPTIONS } from '@common/jobs/jobs.service';
import delay from '@common/utils/delay';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReceiptsTabActionId } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { noticeOf } from './support/tab-readers';
import { openAppHomeTab } from './support/app-home';
import { seedReceipt, seedReimbursement } from './support/receipts';

// Today is Wednesday 2026-06-17 (TEST_NOW).
const JUNE = '2026-06-01';

// Open and "Download the month" are jobs (JobsService): an upload that fails
// is retried, and the files go to the DM of the person who asked.
describe('Receipt files', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let finance: Tables<'users'>;
  let anna: Tables<'users'>;
  let sport: Tables<'reimbursements'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  afterEach(() => {
    jest.restoreAllMocks();
    t.slackApi.failNext('files.getUploadURLExternal', 0);
    t.slackApi.failNext('files.completeUploadExternal', 0);
  });

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    finance = await workspace.addUser({
      role: UserRole.Finance,
      name: 'Fay Finance',
    });
    anna = await workspace.addUser({ name: 'Anna Kim' });
    sport = await seedReimbursement(t, workspace, {
      name: 'Sport',
      limitCents: 5000,
    });
  });

  const dmOf = (user: Tables<'users'>) => `D${user.slack_id.slice(1)}`;

  const seed = async (
    user: Tables<'users'>,
    fields: {
      fileName?: string;
      amountCents?: number;
      status?: ReceiptStatus;
      content?: Buffer;
    } = {},
  ) => {
    const receipt = await seedReceipt(t, workspace, user, {
      reimbursement: sport,
      month: JUNE,
      amountCents: fields.amountCents ?? 3000,
      status: fields.status,
      content: fields.content,
    });

    await t.db
      .updateTable('receipts')
      .set({ file_name: fields.fileName ?? 'gym-june.pdf' })
      .where('id', '=', receipt.id)
      .execute();

    return receipt;
  };

  const screen = () =>
    openAppHomeTab(t, workspace, finance, [NavigationActionId.Receipts]);

  const click = (
    user: Tables<'users'>,
    view: View,
    actionId: string,
    value?: string,
  ) => t.slack.actOnView(workspace, user, view, actionId, value).expect(200);

  const noticesSince = (since: number) =>
    t.slackApi
      .callsWith(workspace.token, 'views.publish', { since })
      .map(({ params }) => noticeOf(params.view as View))
      .sort();

  const filesTo = (user: Tables<'users'>, since: number) =>
    t.slackApi.uploadedFiles(workspace.token, dmOf(user), { since });

  const textsTo = (user: Tables<'users'>, since: number) =>
    t.slackApi
      .shownMessages(workspace.token, user.slack_id, { since })
      .map(({ text }) => text);

  // The archive's jobs still saved: waiting, running or to be retried.
  const savedJobs = async () => {
    const { schema } = t.app.get(JOBS_OPTIONS);
    const { rows } = await sql<{ name: string }>`
      select name from ${sql.id(schema, 'job')}
      where name like 'receipts-month%' and state < 'completed'
    `.execute(t.db);

    return rows.map(({ name }) => name);
  };

  const isPart = (name: string) => name === 'receipts-month-part';

  const waitFor = async (condition: () => Promise<boolean>) => {
    for (let tries = 0; !(await condition()); tries++) {
      if (tries > 100) {
        throw new Error('Waited too long');
      }

      await delay(20);
    }
  };

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

  describe('Open', () => {
    it('sends the receipt’s file to Finance’s DM, byte for byte', async () => {
      const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0x00, 0x80]);
      const receipt = await seed(anna, { content: bytes });
      const tab = await screen();
      const since = t.slackApi.mark();

      await click(finance, tab, ReceiptsTabActionId.OpenReceipt, receipt.id);
      await t.idle();

      expect(noticesSince(since)).toEqual([
        '📎 Sending gym-june.pdf to your Messages.',
      ]);
      expect(textsTo(finance, since)).toEqual([
        '🧾 Anna Kim · Sport · June 2026 · $30.00',
      ]);
      const [file] = filesTo(finance, since);

      expect(file.filename).toBe('gym-june.pdf');
      expect(file.bytes.equals(bytes)).toBe(true);
    });

    it('opens a decided receipt from its menu', async () => {
      const receipt = await seed(anna, { status: ReceiptStatus.Accepted });
      const tab = await screen();
      const since = t.slackApi.mark();

      await click(
        finance,
        tab,
        ReceiptsTabActionId.ManageReceiptMenu,
        `${ReceiptsTabActionId.OpenReceipt}:${receipt.id}`,
      );
      await t.idle();

      expect(filesTo(finance, since)).toHaveLength(1);
    });

    it('says that the file was deleted after the retention period, and sends nothing', async () => {
      const receipt = await seed(anna);
      await t.db
        .updateTable('receipts')
        .set({ file_deleted_at: new Date().toISOString() })
        .where('id', '=', receipt.id)
        .execute();
      const tab = await screen();
      const since = t.slackApi.mark();

      await click(finance, tab, ReceiptsTabActionId.OpenReceipt, receipt.id);
      await t.idle();

      expect(noticesSince(since)).toEqual([
        'This file was deleted after the retention period.',
      ]);
      expect(
        t.slackApi.callsWith(workspace.token, 'chat.postMessage', { since }),
      ).toEqual([]);
    });

    it('is refused to anyone but Admin and Finance, with a real receipt ID', async () => {
      const receipt = await seed(anna);
      const hr = await workspace.addUser({ role: UserRole.HR });
      const tab = await screen();
      const since = t.slackApi.mark();

      await click(hr, tab, ReceiptsTabActionId.OpenReceipt, receipt.id);
      await click(anna, tab, ReceiptsTabActionId.OpenReceipt, receipt.id);
      await t.idle();

      expect(filesTo(hr, since)).toEqual([]);
      expect(filesTo(anna, since)).toEqual([]);
      expect(
        t.slackApi.callsWith(workspace.token, 'files.getUploadURLExternal', {
          since,
        }),
      ).toEqual([]);
    });

    it('sends nothing of another workspace’s receipt', async () => {
      const other = await t.createWorkspace();
      const stranger = await other.addUser({ name: 'Stranger' });
      const strangersGym = await seedReimbursement(t, other);
      const strangers = await seedReceipt(t, other, stranger, {
        reimbursement: strangersGym,
        month: JUNE,
        amountCents: 1000,
      });
      const tab = await screen();
      const since = t.slackApi.mark();

      await t.slack
        .interaction({
          type: 'block_actions',
          team: { id: workspace.slackId },
          user: { id: finance.slack_id, team_id: workspace.slackId },
          trigger_id: 'trigger-forged',
          container: { type: 'view' },
          view: { team_id: workspace.slackId, ...tab },
          actions: [
            {
              block_id: 'forged',
              action_ts: '1',
              type: 'button',
              action_id: ReceiptsTabActionId.OpenReceipt,
              value: strangers.id,
            },
          ],
        })
        .expect(200);
      await t.idle();

      expect(filesTo(finance, since)).toEqual([]);
      expect(noticesSince(since)).toEqual([
        '⚠️ This receipt no longer exists.',
      ]);
    });

    it('asks for a reinstall without files:write', async () => {
      const receipt = await seed(anna);
      const tab = await screen();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.getUploadURLExternal', 1, 'missing_scope');

      await click(finance, tab, ReceiptsTabActionId.OpenReceipt, receipt.id);
      await t.idle();

      expect(textsTo(finance, since)).toEqual([
        `🧾 Anna Kim · Sport · June 2026 · $30.00\n${NO_FILES_PERMISSION}`,
      ]);
    });
  });

  describe('Download the month', () => {
    const entriesOf = (bytes: Buffer) => unzipSync(new Uint8Array(bytes));

    it('sends one archive: the two CSVs and the files', async () => {
      const gym = Buffer.from('gym bytes');
      await seed(anna, { content: gym, status: ReceiptStatus.Accepted });
      await seed(anna, {
        fileName: 'draft.pdf',
        status: ReceiptStatus.Draft,
        content: Buffer.from('draft bytes'),
      });
      const tab = await screen();
      const since = t.slackApi.mark();

      await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
      await t.idle();

      expect(noticesSince(since)).toEqual([
        '📦 Sending the archive to your Messages.',
      ]);
      expect(textsTo(finance, since)).toEqual([
        '📦 Receipts for Sport, June 2026 (part 1 of 1).',
      ]);
      const sent = filesTo(finance, since);

      expect(sent).toHaveLength(1);

      const entries = entriesOf(sent[0].bytes);

      expect(Object.keys(entries).sort()).toEqual([
        'Anna Kim - 1.pdf',
        'receipts.csv',
        'totals.csv',
      ]);
      expect(Buffer.from(entries['Anna Kim - 1.pdf']).equals(gym)).toBe(true);
      expect(Buffer.from(entries['totals.csv']).toString()).toBe(
        '﻿Person,Email,Accepted,Limit,To reimburse\r\n' +
          `Anna Kim,${anna.email},30.00,50.00,30.00\r\n`,
      );
      expect(Buffer.from(entries['receipts.csv']).toString()).toContain(
        `Anna Kim,${anna.email},,Sport,2026-06,30.00,USD,accepted,`,
      );
    });

    it('is not offered for a month with no receipts', async () => {
      const tab = await screen();

      expect(JSON.stringify(tab.blocks)).not.toContain(
        ReceiptsTabActionId.DownloadMonth,
      );
    });

    describe('in parts', () => {
      // The app's limits on a part and on how fast parts start, which the
      // tests lower and raise.
      const limits = () => t.app.get(RECEIPTS_ARCHIVE_LIMITS);
      let original: IReceiptsArchiveLimits;

      beforeEach(async () => {
        original = { ...limits() };
        limits().partBytes = 1024;
        limits().partsPerSecond = 100;

        for (let i = 0; i < 3; i++) {
          await seed(anna, {
            content: Buffer.alloc(600, i + 1),
            status: ReceiptStatus.Accepted,
          });
        }
      });

      afterEach(() => {
        Object.assign(limits(), original);
      });

      const partsSent = (since: number) =>
        filesTo(finance, since)
          .map(({ filename }) => filename)
          .sort();

      const ALL_PARTS = [
        'Receipts Sport 2026-06 part 1 of 3.zip',
        'Receipts Sport 2026-06 part 2 of 3.zip',
        'Receipts Sport 2026-06 part 3 of 3.zip',
      ];

      it('sends a part at a time, the CSVs in the first', async () => {
        const tab = await screen();
        const since = t.slackApi.mark();

        await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
        await t.idle();

        expect(textsTo(finance, since)).toEqual([
          '📦 Receipts for Sport, June 2026 (part 1 of 3).',
          '📦 Receipts for Sport, June 2026 (part 2 of 3).',
          '📦 Receipts for Sport, June 2026 (part 3 of 3).',
        ]);
        expect(
          filesTo(finance, since).map(({ bytes }) =>
            Object.keys(entriesOf(bytes)).sort(),
          ),
        ).toEqual([
          ['Anna Kim - 1.pdf', 'receipts.csv', 'totals.csv'],
          ['Anna Kim - 2.pdf'],
          ['Anna Kim - 3.pdf'],
        ]);
      });

      it('sends again only the part that failed, on its retry', async () => {
        const shareFile = t.slackApi.shareFile.bind(t.slackApi);
        let failed = false;

        jest
          .spyOn(t.slackApi, 'shareFile')
          .mockImplementation(async (params) => {
            if (!failed && params.title.includes('part 2 of 3')) {
              failed = true;
              throw new Error('Slack is down');
            }

            return shareFile(params);
          });
        const tab = await screen();
        const since = t.slackApi.mark();

        await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
        await t.idle();

        expect(partsSent(since)).toEqual([ALL_PARTS[0], ALL_PARTS[2]]);

        await t.retryJobs();

        expect(partsSent(since)).toEqual(ALL_PARTS);
        expect(textsTo(finance, since)).toHaveLength(3);
      });

      it('starts no second set while parts are still on their way', async () => {
        const tab = await screen();
        const since = t.slackApi.mark();
        const openUploads = holdUploads();

        try {
          await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
          // Only the parts are left: the job that planned them is done.
          await waitFor(async () => {
            const saved = await savedJobs();

            return saved.length > 0 && saved.every(isPart);
          });

          await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
        } finally {
          openUploads();
        }
        await t.idle();

        expect(noticesSince(since)).toEqual([
          '📦 Sending the archive to your Messages.',
          '📦 The archive is already on its way to your Messages.',
        ]);
        expect(partsSent(since)).toEqual(ALL_PARTS);
      });

      it('asks for a reinstall once without files:write', async () => {
        const tab = await screen();
        const since = t.slackApi.mark();
        t.slackApi.failNext('files.getUploadURLExternal', 3, 'missing_scope');

        await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
        await t.idle();
        await t.retryJobs();

        expect(textsTo(finance, since)).toEqual([
          `📦 Receipts for Sport, June 2026 (part 1 of 3).\n${NO_FILES_PERMISSION}`,
        ]);
        expect(await savedJobs()).toEqual([]);
      });
    });

    it('is on its way once: a second click while one is saved starts no other', async () => {
      await seed(anna, { status: ReceiptStatus.Accepted });
      const tab = await screen();
      const since = t.slackApi.mark();
      const openUploads = holdUploads();

      await Promise.all([
        click(finance, tab, ReceiptsTabActionId.DownloadMonth),
        click(finance, tab, ReceiptsTabActionId.DownloadMonth),
      ]);
      openUploads();
      await t.idle();

      expect(noticesSince(since)).toEqual([
        '📦 Sending the archive to your Messages.',
        '📦 The archive is already on its way to your Messages.',
      ]);
      expect(filesTo(finance, since)).toHaveLength(1);
    });

    it('sends the archive on a retry when sharing failed, with one message', async () => {
      await seed(anna, { status: ReceiptStatus.Accepted });
      const tab = await screen();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.completeUploadExternal', 1);

      await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
      await t.idle();

      expect(filesTo(finance, since)).toEqual([]);

      await t.retryJobs();

      expect(textsTo(finance, since)).toEqual([
        '📦 Receipts for Sport, June 2026 (part 1 of 1).',
      ]);
      expect(filesTo(finance, since)).toHaveLength(1);
    });

    it('asks for a reinstall without files:write', async () => {
      await seed(anna, { status: ReceiptStatus.Accepted });
      const tab = await screen();
      const since = t.slackApi.mark();
      t.slackApi.failNext('files.getUploadURLExternal', 1, 'missing_scope');

      await click(finance, tab, ReceiptsTabActionId.DownloadMonth);
      await t.idle();
      const calls = t.slackApi.mark();
      await t.retryJobs();

      expect(textsTo(finance, since)).toEqual([
        `📦 Receipts for Sport, June 2026 (part 1 of 1).\n${NO_FILES_PERMISSION}`,
      ]);
      expect(t.slackApi.mark()).toBe(calls);
    });

    it('is refused to anyone but Admin and Finance', async () => {
      await seed(anna, { status: ReceiptStatus.Accepted });
      const hr = await workspace.addUser({ role: UserRole.HR });
      const tab = await screen();
      const since = t.slackApi.mark();

      await click(hr, tab, ReceiptsTabActionId.DownloadMonth);
      await t.idle();

      expect(filesTo(hr, since)).toEqual([]);
      expect(
        t.slackApi.callsWith(workspace.token, 'files.getUploadURLExternal', {
          since,
        }),
      ).toEqual([]);
    });
  });
});
