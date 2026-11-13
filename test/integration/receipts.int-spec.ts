import { ForbiddenException, NotFoundException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptsService } from '@modules/receipts/services/receipts.service';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { seedReceipt, seedReimbursement } from './support/receipts';

const asUser = (row: Tables<'users'>) => row as unknown as IUserViewModel;

describe('Receipts', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let owner: Tables<'users'>;
  let other: Tables<'users'>;
  let gym: Tables<'reimbursements'>;
  let service: ReceiptsService;

  const input = (slackFileId: string, content: Buffer) => ({
    user: asUser(owner),
    slackFileId,
    fileName: 'gym.pdf',
    mimeType: 'application/pdf',
    content,
  });

  const details = (reimbursementId = gym.id) => ({
    reimbursementId,
    month: '2026-05-01',
    amountCents: 4550,
    comment: null,
  });

  const rows = (table: 'receipts' | 'receipt_files') =>
    t.db
      .selectFrom(table)
      .selectAll()
      .where('slack_team_id', '=', workspace.id)
      .execute();

  beforeAll(async () => {
    t = await createTestApp();
    service = t.app.get(ReceiptsService);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    owner = await workspace.addUser();
    other = await workspace.addUser();
    gym = await seedReimbursement(t, workspace);
  });

  describe('receiving a file', () => {
    it('stores a draft and its file once for one Slack file', async () => {
      const first = await service.receive(input('F1', Buffer.from('bytes')));
      const second = await service.receive(input('F1', Buffer.from('bytes')));

      expect(first.outcome).toBe('created');
      expect(first.receipt.status).toBe(ReceiptStatus.Draft);
      expect(second.outcome).toBe('again');
      expect(second.receipt.id).toBe(first.receipt.id);
      expect(await rows('receipts')).toHaveLength(1);
      expect(await rows('receipt_files')).toHaveLength(1);
      expect(
        await t.app.get(ReceiptFileStore).get(first.receipt.id, workspace.id),
      ).toEqual(Buffer.from('bytes'));
    });

    it('calls the same bytes under another Slack file a duplicate', async () => {
      const first = await service.receive(input('F1', Buffer.from('bytes')));
      const second = await service.receive(input('F2', Buffer.from('bytes')));

      expect(second.outcome).toBe('duplicate');
      expect(second.receipt.id).toBe(first.receipt.id);
      expect(await rows('receipts')).toHaveLength(1);
    });

    it('takes the same bytes again once the first receipt was rejected', async () => {
      const first = await service.receive(input('F1', Buffer.from('bytes')));

      await t.db
        .updateTable('receipts')
        .set({
          status: ReceiptStatus.Rejected,
          reimbursement_id: gym.id,
          month: '2026-05-01',
          amount_cents: 1000,
        })
        .where('id', '=', first.receipt.id)
        .execute();

      const second = await service.receive(input('F2', Buffer.from('bytes')));

      expect(second.outcome).toBe('created');
      expect(await rows('receipts')).toHaveLength(2);
    });
  });

  describe('saving the details', () => {
    it('refuses another member', async () => {
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await expect(
        service.saveDetails(receipt.id, details(), asUser(other)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('does not find a receipt of another workspace', async () => {
      const elsewhere = await t.createWorkspace();
      const stranger = await elsewhere.addUser();
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await expect(
        service.saveDetails(receipt.id, details(), asUser(stranger)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('submits the receipt for its owner', async () => {
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      const saved = await service.saveDetails(
        receipt.id,
        details(),
        asUser(owner),
      );

      expect(saved.status).toBe(ReceiptStatus.Submitted);
      expect(saved.amountCents).toBe(4550);
      expect(saved.submittedAt).not.toBeNull();
    });

    it('refuses an accepted receipt', async () => {
      const accepted = await seedReceipt(t, workspace, owner, {
        reimbursement: gym,
        month: '2026-05-01',
        amountCents: 1000,
        status: ReceiptStatus.Accepted,
      });

      await expect(
        service.saveDetails(accepted.id, details(), asUser(owner)),
      ).rejects.toThrow();
    });

    it('resubmits a rejected receipt and clears the reason', async () => {
      const rejected = await seedReceipt(t, workspace, owner, {
        reimbursement: gym,
        month: '2026-05-01',
        amountCents: 1000,
        status: ReceiptStatus.Rejected,
      });

      await t.db
        .updateTable('receipts')
        .set({ rejection_reason: 'Unreadable' })
        .where('id', '=', rejected.id)
        .execute();

      const saved = await service.saveDetails(
        rejected.id,
        details(),
        asUser(owner),
      );

      expect(saved.status).toBe(ReceiptStatus.Submitted);
      expect(saved.rejectionReason).toBeNull();
    });

    it('refuses a reimbursement archived meanwhile and stays a draft', async () => {
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await t.db
        .updateTable('reimbursements')
        .set({ archived_at: new Date().toISOString() })
        .where('id', '=', gym.id)
        .execute();

      await expect(
        service.saveDetails(receipt.id, details(), asUser(owner)),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        field: 'reimbursement',
      });

      const [row] = await rows('receipts');

      expect(row.status).toBe(ReceiptStatus.Draft);
    });

    it('refuses another workspace’s reimbursement', async () => {
      const elsewhere = await t.createWorkspace();
      const foreign = await seedReimbursement(t, elsewhere);
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await expect(
        service.saveDetails(receipt.id, details(foreign.id), asUser(owner)),
      ).rejects.toMatchObject({
        constructor: ValidationError,
        field: 'reimbursement',
      });
    });

    it('refuses a month that is not offered and a bad amount', async () => {
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await expect(
        service.saveDetails(
          receipt.id,
          { ...details(), month: '2025-01-01' },
          asUser(owner),
        ),
      ).rejects.toMatchObject({ field: 'month' });

      await expect(
        service.saveDetails(
          receipt.id,
          { ...details(), amountCents: 0 },
          asUser(owner),
        ),
      ).rejects.toMatchObject({ field: 'amount' });
    });
  });

  describe('deleting', () => {
    it('refuses an accepted receipt', async () => {
      const accepted = await seedReceipt(t, workspace, owner, {
        reimbursement: gym,
        month: '2026-05-01',
        amountCents: 1000,
        status: ReceiptStatus.Accepted,
      });

      await expect(
        service.delete(accepted.id, asUser(owner)),
      ).rejects.toThrow();
      expect(await rows('receipts')).toHaveLength(1);
    });

    it('refuses another member', async () => {
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await expect(
        service.delete(receipt.id, asUser(other)),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('removes a draft with its file', async () => {
      const { receipt } = await service.receive(input('F1', Buffer.from('a')));

      await service.delete(receipt.id, asUser(owner));

      expect(await rows('receipts')).toHaveLength(0);
      expect(await rows('receipt_files')).toHaveLength(0);
    });
  });

  describe('listing', () => {
    it('lists the owner’s receipts, newest month first, without reading files', async () => {
      const april = await seedReceipt(t, workspace, owner, {
        reimbursement: gym,
        month: '2026-04-01',
        amountCents: 1000,
      });
      const may = await seedReceipt(t, workspace, owner, {
        reimbursement: gym,
        month: '2026-05-01',
        amountCents: 2000,
      });

      await seedReceipt(t, workspace, other, {
        reimbursement: gym,
        month: '2026-05-01',
        amountCents: 3000,
      });

      await t.idle();
      const since = t.sql.mark();
      const own = await service.findOwn(asUser(owner));

      await t.idle();

      expect(own.map((receipt) => receipt.id)).toEqual([may.id, april.id]);
      expect(
        t.sql
          .statements(since)
          .filter(({ text }) => text.includes('receipt_files')),
      ).toEqual([]);
    });
  });
});
