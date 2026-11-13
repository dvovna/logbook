import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { receiptLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import {
  assertCanManageReceipts,
  RECEIPT_ADMIN_ROLES,
} from '@modules/receipts/constants/receipt-roles';
import { MAX_RECEIPT_REJECTION_REASON_LENGTH } from '@modules/receipts/constants/receipt-limits';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptChangedError } from '@modules/receipts/errors/receipt-changed.error';
import {
  RECEIPT_REJECTED,
  ReceiptRejectedEvent,
} from '@modules/receipts/events/receipt-rejected.event';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';

@Injectable()
export class ReceiptDecisionsService {
  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly users: UsersService,
    private readonly transactions: TransactionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public accept(
    receiptId: string,
    actor: IUserViewModel,
  ): Promise<IReceiptViewModel> {
    return this.decide(receiptId, actor, {
      status: ReceiptStatus.Accepted,
      rejection_reason: null,
    });
  }

  public async reject(
    receiptId: string,
    reason: string,
    actor: IUserViewModel,
  ): Promise<IReceiptViewModel> {
    const trimmed = reason.trim();

    if (!trimmed || trimmed.length > MAX_RECEIPT_REJECTION_REASON_LENGTH) {
      throw new ValidationError(
        `Give a reason of at most ${MAX_RECEIPT_REJECTION_REASON_LENGTH} characters.`,
        'reason',
      );
    }

    return this.decide(receiptId, actor, {
      status: ReceiptStatus.Rejected,
      rejection_reason: trimmed,
    });
  }

  // A decision is made on the receipt as the person saw it: the update takes
  // only a receipt still in that status and sent at that moment (its owner
  // sending it again is a new one), so of two decisions at once the second
  // finds it changed, and an owner's change meanwhile is never decided over.
  private async decide(
    receiptId: string,
    actor: IUserViewModel,
    change: { status: ReceiptStatus; rejection_reason: string | null },
  ): Promise<IReceiptViewModel> {
    assertCanManageReceipts(actor);

    const receipt = await this.receipts.findOne({
      id: receiptId,
      slack_team_id: actor.slack_team_id,
    });

    if (!receipt) {
      throw new NotFoundException(`Receipt ${receiptId} not found`);
    }

    if (
      receipt.status === ReceiptStatus.Draft ||
      receipt.status === change.status
    ) {
      throw new ValidationError(
        receipt.status === ReceiptStatus.Draft
          ? 'This receipt has not been sent for checking yet.'
          : 'This receipt was changed meanwhile.',
      );
    }

    await this.assertNotOwnReceipt(receipt, actor);

    return this.transactions.transaction(async () => {
      await this.transactions.lock(receiptLock(receipt.id));

      const [decided] = await this.receipts.updateMany(
        {
          id: receipt.id,
          slack_team_id: actor.slack_team_id,
          status: receipt.status,
          submitted_at: receipt.submittedAt,
        },
        {
          ...change,
          decided_by: actor.id,
          decided_at: new Date().toISOString(),
        },
      );

      if (!decided) {
        throw new ReceiptChangedError();
      }

      if (change.status === ReceiptStatus.Rejected) {
        // Inside the transaction: the listener saves the owner's DM with it.
        await this.eventEmitter.emitAsync(
          RECEIPT_REJECTED,
          new ReceiptRejectedEvent(decided.id, decided.slackTeamId),
        );
      }

      return decided;
    });
  }

  // Nobody decides their own receipt, unless nobody else could.
  private async assertNotOwnReceipt(
    receipt: IReceiptViewModel,
    actor: IUserViewModel,
  ): Promise<void> {
    if (receipt.userId !== actor.id) {
      return;
    }

    const deciders = await this.users.findMany({
      slackTeamId: actor.slack_team_id,
      roles: [...RECEIPT_ADMIN_ROLES],
    });

    if (deciders.some(({ id }) => id !== actor.id)) {
      throw new ForbiddenException('Someone else decides on your receipts.');
    }
  }
}
