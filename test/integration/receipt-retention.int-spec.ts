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

  const seed = async (status: ReceiptStatus, ageDays: number, now: Date) => {
    const receipt = await seedReceipt(t, workspace, anna, {
      reimbursement: sport,
      month: JUNE,
      amountCents: 3000,
      status,
    });

    await t.db
      .updateTable('receipts')
      .set({
        created_at: new Date(now.getTime() - ageDays * DAY_MS).toISOString(),
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

  it('keeps the row of an old receipt and deletes its file, once', async () => {
    const accepted = await seed(ReceiptStatus.Accepted, 0, new Date());
    const recent = await seed(ReceiptStatus.Rejected, 0, new Date());

    travelTo('2029-06-20');
    await t.db
      .updateTable('receipts')
      .set({ created_at: '2029-06-19T00:00:00Z' })
      .where('id', '=', recent.id)
      .execute();

    expect(await retention.sweepWorkspace(workspace.id)).toEqual({
      files: 1,
      drafts: 0,
    });

    expect((await rowOf(accepted.id))?.file_deleted_at).not.toBeNull();
    expect(await fileOf(accepted.id)).toBeUndefined();
    expect((await rowOf(recent.id))?.file_deleted_at).toBeNull();
    expect(await fileOf(recent.id)).toBeDefined();
    expect(await retention.sweepWorkspace(workspace.id)).toEqual({
      files: 0,
      drafts: 0,
    });
  });

  it('deletes the files of several receipts at once', async () => {
    const now = new Date();
    const old = new Date(now.getTime() - 1100 * DAY_MS);
    const ids: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      ids.push((await seed(ReceiptStatus.Submitted, 0, now)).id);
    }
    await t.db
      .updateTable('receipts')
      .set({ created_at: old.toISOString() })
      .where('id', 'in', ids)
      .execute();

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
    const receipt = await seed(ReceiptStatus.Draft, 31, new Date());

    await retention.sweep();

    expect(await rowOf(receipt.id)).toBeUndefined();
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
