import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { DAY_MS } from '@common/utils/date.utils';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptRetentionService } from '@modules/receipts/services/receipt-retention.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { ReceiptsTabActionId } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { View } from '@slack/types/dist/views';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { noticeOf } from './support/tab-readers';
import { openAppHomeTab } from './support/app-home';
import { seedReceipt, seedReimbursement } from './support/receipts';
import { travelTo } from './support/clock';

const JUNE = '2026-06-01';

describe('Receipt retention', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let anna: Tables<'users'>;
  let sport: Tables<'reimbursements'>;
  let retention: ReceiptRetentionService;

  beforeAll(async () => {
    t = await createTestApp();
    retention = t.app.get(ReceiptRetentionService);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    anna = await workspace.addUser({ name: 'Anna Kim' });
    sport = await seedReimbursement(t, workspace, { name: 'Sport' });
  });

  const daysBefore = (now: Date, days: number) =>
    new Date(now.getTime() - days * DAY_MS).toISOString();

  // Decided receipts are decided as old as they are, unless said otherwise.
  const seed = async (
    status: ReceiptStatus,
    ageDays: number,
    now: Date,
    decidedDaysAgo: number | null = status === ReceiptStatus.Accepted ||
    status === ReceiptStatus.Rejected
      ? ageDays
      : null,
  ) => {
    const receipt = await seedReceipt(t, workspace, anna, {
      reimbursement: sport,
      month: JUNE,
      amountCents: 3000,
      status,
    });

    await t.db
      .updateTable('receipts')
      .set({
        created_at: daysBefore(now, ageDays),
        decided_at:
          decidedDaysAgo === null ? null : daysBefore(now, decidedDaysAgo),
      })
      .where('id', '=', receipt.id)
      .execute();

    return receipt;
  };

  const rowOf = (id: string) =>
    t.db
      .selectFrom('receipts')
      .select(['id', 'file_deleted_at'])
      .where('id', '=', id)
      .executeTakeFirst();

  const fileOf = (id: string) =>
    t.db
      .selectFrom('receipt_files')
      .select('receipt_id')
      .where('receipt_id', '=', id)
      .executeTakeFirst();

  it('deletes a draft after 30 days, with its file, and keeps a younger one', async () => {
    const now = new Date();
    const old = await seed(ReceiptStatus.Draft, 31, now);
    const young = await seed(ReceiptStatus.Draft, 29, now);

    expect(await retention.sweepWorkspace(workspace.id, now)).toEqual({
      files: 0,
      drafts: 1,
    });

    expect(await rowOf(old.id)).toBeUndefined();
    expect(await fileOf(old.id)).toBeUndefined();
    expect(await rowOf(young.id)).toBeDefined();
    expect(await fileOf(young.id)).toBeDefined();
  });

  it('keeps the row of an old decided receipt and deletes its file, once', async () => {
    const now = new Date();
    const accepted = await seed(ReceiptStatus.Accepted, 0, now);
    const rejected = await seed(ReceiptStatus.Rejected, 0, now);
    const recent = await seed(ReceiptStatus.Rejected, 0, now);

    travelTo('2029-06-20');
    await t.db
      .updateTable('receipts')
      .set({ decided_at: '2029-06-19T00:00:00Z' })
      .where('id', '=', recent.id)
      .execute();

    expect(await retention.sweepWorkspace(workspace.id)).toEqual({
      files: 2,
      drafts: 0,
    });

    for (const { id } of [accepted, rejected]) {
      expect((await rowOf(id))?.file_deleted_at).not.toBeNull();
      expect(await fileOf(id)).toBeUndefined();
    }
    expect((await rowOf(recent.id))?.file_deleted_at).toBeNull();
    expect(await fileOf(recent.id)).toBeDefined();
    expect(await retention.sweepWorkspace(workspace.id)).toEqual({
      files: 0,
      drafts: 0,
    });
  });

  it('keeps the file of a receipt nobody has decided, however old', async () => {
    const now = new Date();
    const waiting = await seed(ReceiptStatus.Submitted, 4 * 365, now);

    expect(await retention.sweepWorkspace(workspace.id, now)).toEqual({
      files: 0,
      drafts: 0,
    });

    expect((await rowOf(waiting.id))?.file_deleted_at).toBeNull();
    expect(await fileOf(waiting.id)).toBeDefined();
  });

  it('counts the retention from the decision, not from when the receipt was sent', async () => {
    const now = new Date();
    const decidedYesterday = await seed(
      ReceiptStatus.Accepted,
      4 * 365,
      now,
      1,
    );

    expect(await retention.sweepWorkspace(workspace.id, now)).toEqual({
      files: 0,
      drafts: 0,
    });

    expect((await rowOf(decidedYesterday.id))?.file_deleted_at).toBeNull();
    expect(await fileOf(decidedYesterday.id)).toBeDefined();
  });

  it('deletes the files of several receipts at once', async () => {
    const now = new Date();

    for (let i = 0; i < 3; i += 1) {
      await seed(ReceiptStatus.Accepted, 1100, now);
    }

    expect(await retention.sweepWorkspace(workspace.id, now)).toEqual({
      files: 3,
      drafts: 0,
    });
  });

  it('makes Open answer with the retention notice', async () => {
    const receipt = await seed(ReceiptStatus.Accepted, 0, new Date());
    const finance = await workspace.addUser({ role: UserRole.Finance });

    const tab = await openAppHomeTab(t, workspace, finance, [
      NavigationActionId.Receipts,
    ]);

    travelTo('2029-06-20');
    await retention.sweepWorkspace(workspace.id);
    const since = t.slackApi.mark();

    await t.slack
      .actOnView(
        workspace,
        finance,
        tab as View,
        ReceiptsTabActionId.ManageReceiptMenu,
        `${ReceiptsTabActionId.OpenReceipt}:${receipt.id}`,
      )
      .expect(200);
    await t.idle();

    expect(
      t.slackApi
        .callsWith(workspace.token, 'views.publish', { since })
        .map(({ params }) => noticeOf(params.view as View)),
    ).toEqual(['This file was deleted after the retention period.']);
  });

  it('sweeps every installed workspace', async () => {
    const now = new Date();
    const receipt = await seed(ReceiptStatus.Draft, 31, now);
    const other = await t.createWorkspace();
    const bob = await other.addUser({ name: 'Bob' });
    const gym = await seedReimbursement(t, other, { name: 'Gym' });
    const youngDraft = await seedReceipt(t, other, bob, {
      reimbursement: gym,
      month: JUNE,
      amountCents: 1000,
      status: ReceiptStatus.Draft,
    });
    const recentFile = await seedReceipt(t, other, bob, {
      reimbursement: gym,
      month: JUNE,
      amountCents: 1000,
      status: ReceiptStatus.Accepted,
    });

    await retention.sweep(now);

    expect(await rowOf(receipt.id)).toBeUndefined();
    expect(await rowOf(youngDraft.id)).toBeDefined();
    expect(await fileOf(youngDraft.id)).toBeDefined();
    expect((await rowOf(recentFile.id))?.file_deleted_at).toBeNull();
    expect(await fileOf(recentFile.id)).toBeDefined();
  });

  it('leaves no row of the feature behind when the workspace is deleted', async () => {
    await seed(ReceiptStatus.Accepted, 0, new Date());
    await t.db
      .insertInto('reimbursement_opt_outs')
      .values({
        slack_team_id: workspace.id,
        user_id: anna.id,
        reimbursement_id: sport.id,
      })
      .execute();
    await t.db
      .insertInto('reimbursement_reminders')
      .values({
        slack_team_id: workspace.id,
        reimbursement_id: sport.id,
        month: JUNE,
        kind: 'opened',
      })
      .execute();

    expect(
      await t.app.get(SlackTeamsService).deleteWorkspace(workspace.id),
    ).toBe(true);

    for (const table of [
      'reimbursements',
      'receipts',
      'receipt_files',
      'reimbursement_opt_outs',
      'reimbursement_reminders',
    ] as const) {
      const rows = await t.db
        .selectFrom(table)
        .select('slack_team_id')
        .where('slack_team_id', '=', workspace.id)
        .execute();

      expect({ table, rows: rows.length }).toEqual({ table, rows: 0 });
    }
  });
});
