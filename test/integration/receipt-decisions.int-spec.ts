import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptChangedError } from '@modules/receipts/errors/receipt-changed.error';
import { RECEIPT_REJECTED } from '@modules/receipts/events/receipt-rejected.event';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReceiptDecisionsService } from '@modules/receipts/services/receipt-decisions.service';
import { ReceiptsMonthService } from '@modules/receipts/services/receipts-month.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { seedReceipt, seedReimbursement } from './support/receipts';

const asUser = (row: Tables<'users'>) => row as unknown as IUserViewModel;

describe('Receipt decisions', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let finance: Tables<'users'>;
  let gym: Tables<'reimbursements'>;
  let member: Tables<'users'>;
  let decisions: ReceiptDecisionsService;
  let months: ReceiptsMonthService;
  let rejected: unknown[];
  const listener = (event: unknown) => rejected.push(event);

  const receiptRow = (id: string) =>
    t.db
      .selectFrom('receipts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const submitted = (
    owner = member,
    status = ReceiptStatus.Submitted,
    amountCents = 1000,
  ) =>
    seedReceipt(t, workspace, owner, {
      reimbursement: gym,
      month: '2026-05-01',
      amountCents,
      status,
    });

  beforeAll(async () => {
    t = await createTestApp();
    decisions = t.app.get(ReceiptDecisionsService);
    months = t.app.get(ReceiptsMonthService);
    t.app.get(EventEmitter2).on(RECEIPT_REJECTED, listener);
  });

  afterAll(async () => {
    t.app.get(EventEmitter2).off(RECEIPT_REJECTED, listener);
    await t.close();
  });

  beforeEach(async () => {
    rejected = [];
    workspace = await t.createWorkspace();
    finance = await workspace.addUser({ role: UserRole.Finance });
    member = await workspace.addUser();
    gym = await seedReimbursement(t, workspace, { limitCents: 5000 });
  });

  it.each([UserRole.HR, UserRole.Manager, UserRole.Member])(
    'refuses %s',
    async (role) => {
      const person = await workspace.addUser({ role });
      const receipt = await submitted();

      await expect(
        decisions.accept(receipt.id, asUser(person)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        decisions.reject(receipt.id, 'No', asUser(person)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        months.getMonth(
          { reimbursementId: gym.id, month: '2026-05-01' },
          asUser(person),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    },
  );

  it('accepts and then rejects with a reason', async () => {
    const receipt = await submitted();

    const accepted = await decisions.accept(receipt.id, asUser(finance));

    expect(accepted.status).toBe(ReceiptStatus.Accepted);
    expect((await receiptRow(receipt.id)).decided_by).toBe(finance.id);
    expect(rejected).toHaveLength(0);

    const result = await decisions.reject(
      receipt.id,
      'Blurry',
      asUser(finance),
    );

    expect(result.status).toBe(ReceiptStatus.Rejected);
    expect(result.rejectionReason).toBe('Blurry');
    expect(rejected).toEqual([
      { receiptId: receipt.id, slackTeamId: workspace.id },
    ]);
  });

  it('clears the reason when a rejected receipt is accepted', async () => {
    const receipt = await submitted(member, ReceiptStatus.Rejected);

    const accepted = await decisions.accept(receipt.id, asUser(finance));

    expect(accepted.status).toBe(ReceiptStatus.Accepted);
    expect(accepted.rejectionReason).toBeNull();
  });

  it('needs a reason of at most 500 characters', async () => {
    const receipt = await submitted();

    await expect(
      decisions.reject(receipt.id, '  ', asUser(finance)),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      decisions.reject(receipt.id, 'x'.repeat(501), asUser(finance)),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(rejected).toHaveLength(0);
  });

  it('lets only one of two decisions made at once through', async () => {
    const other = await workspace.addUser({ role: UserRole.Finance });
    const receipt = await submitted();

    // Both read the receipt as submitted before either decides: a decision
    // that reads it after the other's commit is a plain second decision.
    const original = ReceiptsRepository.prototype.findOne;
    let readers = 0;
    let bothRead: () => void = () => undefined;
    const barrier = new Promise<void>((resolve) => (bothRead = resolve));
    const spy = jest
      .spyOn(ReceiptsRepository.prototype, 'findOne')
      .mockImplementation(async function (this: ReceiptsRepository, filter) {
        const read = await original.call(this, filter);

        if (++readers === 2) {
          bothRead();
        }
        await barrier;

        return read;
      });

    const results = await Promise.allSettled([
      decisions.accept(receipt.id, asUser(finance)),
      decisions.reject(receipt.id, 'No', asUser(other)),
    ]);

    spy.mockRestore();

    const fulfilled = results.filter(({ status }) => status === 'fulfilled');
    const failed = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBeInstanceOf(ReceiptChangedError);
    expect(rejected.length).toBeLessThanOrEqual(1);
    expect(rejected.length).toBe(
      (await receiptRow(receipt.id)).status === ReceiptStatus.Rejected ? 1 : 0,
    );
  });

  it('refuses their own receipt to Finance while an Admin exists', async () => {
    await workspace.addUser({ role: UserRole.Admin });
    const receipt = await submitted(finance);

    await expect(
      decisions.accept(receipt.id, asUser(finance)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets the only Admin decide their own receipt', async () => {
    const lonely = await t.createWorkspace();
    const admin = await lonely.addUser({ role: UserRole.Admin });
    const reimbursement = await seedReimbursement(t, lonely);
    const receipt = await seedReceipt(t, lonely, admin, {
      reimbursement,
      month: '2026-05-01',
      amountCents: 500,
    });

    const result = await decisions.accept(receipt.id, asUser(admin));

    expect(result.status).toBe(ReceiptStatus.Accepted);
  });

  it('does not find a receipt of another workspace', async () => {
    const elsewhere = await t.createWorkspace();
    const stranger = await elsewhere.addUser({ role: UserRole.Finance });
    const receipt = await submitted();

    await expect(
      decisions.accept(receipt.id, asUser(stranger)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a draft', async () => {
    const receipt = await submitted(member, ReceiptStatus.Draft);

    await expect(
      decisions.accept(receipt.id, asUser(finance)),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  describe('the month', () => {
    it('sums up each person and names who sent nothing', async () => {
      const quiet = await workspace.addUser({ name: 'Quiet' });
      const away = await workspace.addUser({ name: 'Away' });

      await t.db
        .insertInto('reimbursement_opt_outs')
        .values({
          slack_team_id: workspace.id,
          user_id: away.id,
          reimbursement_id: gym.id,
        })
        .execute();
      await submitted(member, ReceiptStatus.Accepted, 3000);
      await submitted(member, ReceiptStatus.Submitted, 3000);

      const month = await months.getMonth(
        { reimbursementId: gym.id, month: '2026-05-01' },
        asUser(finance),
      );

      expect(month.dueDate).toBe('2026-06-05');
      expect(month.waiting).toBe(1);
      expect(month.people).toHaveLength(1);
      expect(month.people[0]).toMatchObject({
        userId: member.id,
        acceptedCents: 3000,
        submittedCents: 3000,
        overLimit: true,
      });
      expect(month.sentNothing.map(({ userId }) => userId).sort()).toEqual(
        [finance.id, quiet.id].sort(),
      );
    });

    it('lists a deactivated member’s receipt, which Finance can accept', async () => {
      const gone = await workspace.addUser({ name: 'Gone' });
      const receipt = await submitted(gone);

      await t.db
        .updateTable('users')
        .set({ is_active: false })
        .where('id', '=', gone.id)
        .execute();

      const month = await months.getMonth(
        { reimbursementId: gym.id, month: '2026-05-01' },
        asUser(finance),
      );
      const person = month.people.find(({ userId }) => userId === gone.id)!;

      expect(person.active).toBe(false);
      expect(person.receipts).toHaveLength(1);
      expect(month.waiting).toBe(1);
      expect(month.sentNothing.map(({ userId }) => userId)).not.toContain(
        gone.id,
      );
      expect((await decisions.accept(receipt.id, asUser(finance))).status).toBe(
        ReceiptStatus.Accepted,
      );
    });

    it('names who else sent the same file', async () => {
      const content = Buffer.from('same photo');
      const friend = await workspace.addUser({ name: 'Friend' });

      for (const owner of [member, friend]) {
        await seedReceipt(t, workspace, owner, {
          reimbursement: gym,
          month: '2026-05-01',
          amountCents: 100,
          content,
        });
      }

      const month = await months.getMonth(
        { reimbursementId: gym.id, month: '2026-05-01' },
        asUser(finance),
      );
      const ofMember = month.people.find(({ userId }) => userId === member.id)!;

      expect(ofMember.receipts[0].alsoSentBy).toEqual(['Friend']);
    });

    it('reads no receipt files', async () => {
      await submitted();
      const since = t.sql.mark();

      await months.getMonth(
        { reimbursementId: gym.id, month: '2026-05-01' },
        asUser(finance),
      );

      const text = t.sql.statements(since).map(({ text }) => text);

      expect(text.length).toBeGreaterThan(0);
      expect(text.filter((sql) => sql.includes('receipt_files'))).toEqual([]);
    });

    it('does not find a reimbursement of another workspace', async () => {
      const elsewhere = await t.createWorkspace();
      const other = await seedReimbursement(t, elsewhere);

      await expect(
        months.getMonth(
          { reimbursementId: other.id, month: '2026-05-01' },
          asUser(finance),
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
