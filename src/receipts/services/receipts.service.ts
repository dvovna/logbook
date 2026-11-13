import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { receiptLock } from 'src/database/advisory-locks';
import { TransactionService } from 'src/database/transaction.service';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { MAX_RECEIPT_AMOUNT_CENTS } from '@modules/receipts/constants/receipt-limits';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptChangedError } from '@modules/receipts/errors/receipt-changed.error';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { ReimbursementOptOutsService } from '@modules/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';
import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';
import { offeredMonths } from '@modules/receipts/utils/receipt-months';

export interface IReceivedFile {
  user: IUserViewModel;
  slackFileId: string;
  fileName: string;
  mimeType: string;
  content: Buffer;
}

export interface IReceiptDetails {
  reimbursementId: string;
  month: string;
  amountCents: number;
  comment: string | null;
}

export type ReceiveOutcome = 'created' | 'again' | 'duplicate';

const UNIQUE_VIOLATION = '23505';

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } }).cause?.code === UNIQUE_VIOLATION;

const OWNER_CHANGEABLE = [
  ReceiptStatus.Draft,
  ReceiptStatus.Submitted,
  ReceiptStatus.Rejected,
];

@Injectable()
export class ReceiptsService {
  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly files: ReceiptFileStore,
    private readonly reimbursements: ReimbursementsService,
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly transactions: TransactionService,
  ) {}

  // A file Slack announced: a draft with its bytes. Slack may announce one
  // twice (a retried job), and people send the same photo twice.
  public async receive(
    input: IReceivedFile,
  ): Promise<{ outcome: ReceiveOutcome; receipt: IReceiptViewModel }> {
    const slackTeamId = input.user.slack_team_id;
    const known = await this.findBySlackFile(input.slackFileId, slackTeamId);

    if (known) {
      return { outcome: 'again', receipt: known };
    }

    const sha256 = createHash('sha256').update(input.content).digest('hex');
    const [duplicate] = await this.receipts.findMany(
      {
        slack_team_id: slackTeamId,
        user_id: input.user.id,
        sha256,
        status: { operator: 'neq', value: ReceiptStatus.Rejected },
      },
      { orderBy: ['created_at:asc'], limit: 1 },
    );

    if (duplicate) {
      return { outcome: 'duplicate', receipt: duplicate };
    }

    try {
      const receipt = await this.transactions.transaction(async () => {
        const created = await this.receipts.create({
          slack_team_id: slackTeamId,
          user_id: input.user.id,
          status: ReceiptStatus.Draft,
          file_name: input.fileName,
          mime_type: input.mimeType,
          size_bytes: input.content.length,
          sha256,
          slack_file_id: input.slackFileId,
        });

        await this.files.put(created.id, slackTeamId, input.content);

        return created;
      });

      return { outcome: 'created', receipt };
    } catch (error) {
      // Two runs of one file at once: the other one was first.
      const first = isUniqueViolation(error)
        ? await this.findBySlackFile(input.slackFileId, slackTeamId)
        : null;

      if (!first) {
        throw error;
      }

      return { outcome: 'again', receipt: first };
    }
  }

  public async saveDetails(
    receiptId: string,
    details: IReceiptDetails,
    user: IUserViewModel,
  ): Promise<IReceiptViewModel> {
    return this.transactions.transaction(async () => {
      await this.transactions.lock(receiptLock(receiptId));

      const receipt = await this.findOwnById(receiptId, user);

      if (!OWNER_CHANGEABLE.includes(receipt.status)) {
        throw new ValidationError('An accepted receipt can’t be changed.');
      }

      const checked = await this.checkDetails(details, user.slack_team_id);

      const [saved] = await this.receipts.updateMany(
        {
          id: receipt.id,
          slack_team_id: user.slack_team_id,
          status: OWNER_CHANGEABLE,
        },
        {
          reimbursement_id: checked.reimbursementId,
          month: checked.month,
          amount_cents: checked.amountCents,
          comment: checked.comment,
          status: ReceiptStatus.Submitted,
          submitted_at: new Date().toISOString(),
          rejection_reason: null,
          decided_by: null,
          decided_at: null,
        },
      );

      if (!saved) {
        throw new ReceiptChangedError();
      }

      // Sending a receipt for it means the person wants it.
      await this.optOuts.removeFor(
        user.id,
        checked.reimbursementId,
        user.slack_team_id,
      );

      return saved;
    });
  }

  public async delete(receiptId: string, user: IUserViewModel): Promise<void> {
    await this.transactions.transaction(async () => {
      await this.transactions.lock(receiptLock(receiptId));

      const receipt = await this.findOwnById(receiptId, user);

      if (receipt.status === ReceiptStatus.Accepted) {
        throw new ValidationError('An accepted receipt can’t be deleted.');
      }

      // The file goes with the row (ON DELETE CASCADE).
      const deleted = await this.receipts.deleteMany({
        id: receipt.id,
        slack_team_id: user.slack_team_id,
        status: { operator: 'neq', value: ReceiptStatus.Accepted },
      });

      if (deleted !== 1) {
        throw new ReceiptChangedError();
      }
    });
  }

  // The delete of the DM's Discard button, which a stale message can still
  // show after the receipt was sent: only a draft goes, and the caller is
  // told when it was not one.
  public async discardDraft(
    receiptId: string,
    user: IUserViewModel,
  ): Promise<{ discarded: boolean; receipt: IReceiptViewModel }> {
    return this.transactions.transaction(async () => {
      await this.transactions.lock(receiptLock(receiptId));

      const receipt = await this.findOwnById(receiptId, user);

      if (receipt.status !== ReceiptStatus.Draft) {
        return { discarded: false, receipt };
      }

      const deleted = await this.receipts.deleteMany({
        id: receipt.id,
        slack_team_id: user.slack_team_id,
        status: ReceiptStatus.Draft,
      });

      if (deleted !== 1) {
        throw new ReceiptChangedError();
      }

      return { discarded: true, receipt };
    });
  }

  // Newest month first; drafts, which have none yet, come before them.
  public findOwn(user: IUserViewModel): Promise<IReceiptViewModel[]> {
    return this.receipts.findMany(
      { slack_team_id: user.slack_team_id, user_id: user.id },
      { orderBy: ['month:desc', 'created_at:desc'] },
    );
  }

  public async findOwnById(
    receiptId: string,
    user: IUserViewModel,
  ): Promise<IReceiptViewModel> {
    const receipt = await this.findById(receiptId, user.slack_team_id);

    if (!receipt) {
      throw new NotFoundException(`Receipt ${receiptId} not found`);
    }

    if (receipt.userId !== user.id) {
      throw new ForbiddenException('This receipt is not yours.');
    }

    return receipt;
  }

  public findById(receiptId: string, slackTeamId: string) {
    return this.receipts.findOne({ id: receiptId, slack_team_id: slackTeamId });
  }

  private findBySlackFile(slackFileId: string, slackTeamId: string) {
    return this.receipts.findOne({
      slack_team_id: slackTeamId,
      slack_file_id: slackFileId,
    });
  }

  private async checkDetails(
    details: IReceiptDetails,
    slackTeamId: string,
  ): Promise<IReceiptDetails> {
    const reimbursement = await this.reimbursements.findById(
      details.reimbursementId,
      slackTeamId,
    );

    if (!reimbursement || reimbursement.archivedAt) {
      throw new ValidationError(
        'Choose a reimbursement from the list.',
        'reimbursement',
      );
    }

    if (!offeredMonths(getDateOnly(new Date())).includes(details.month)) {
      throw new ValidationError('Choose one of the offered months.', 'month');
    }

    if (
      !Number.isInteger(details.amountCents) ||
      details.amountCents < 1 ||
      details.amountCents > MAX_RECEIPT_AMOUNT_CENTS
    ) {
      throw new ValidationError(
        'The amount must be above zero and at most 1,000,000.00.',
        'amount',
      );
    }

    return { ...details, comment: details.comment?.trim() || null };
  }
}
