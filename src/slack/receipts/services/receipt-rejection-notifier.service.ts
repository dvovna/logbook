import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JobsService } from '@common/jobs/jobs.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ReceiptRejectedMessageView } from '@modules/slack/receipts/views/receipt-rejected-message.view';
import { UsersService } from '@modules/users/services/users.service';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import {
  RECEIPT_REJECTED,
  ReceiptRejectedEvent,
} from 'src/receipts/events/receipt-rejected.event';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';

export const RECEIPT_REJECTED_DM_JOB = 'receipt-rejected-dm';

interface IReceiptRejectedDmJob {
  receiptId: string;
  slackTeamId: string;
}

// Tells a person their receipt was rejected, and why.
@Injectable()
export class ReceiptRejectionNotifier implements OnModuleInit {
  public constructor(
    private readonly jobs: JobsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly receipts: ReceiptsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly users: UsersService,
    private readonly view: ReceiptRejectedMessageView,
  ) {}

  public onModuleInit() {
    this.jobs.define<IReceiptRejectedDmJob>(RECEIPT_REJECTED_DM_JOB, (job) =>
      this.send(job),
    );
  }

  // Runs in the transaction that rejects the receipt (emitAsync), so the
  // job is saved with the rejection.
  @OnEvent(RECEIPT_REJECTED, { suppressErrors: false })
  public async handleRejected({
    receiptId,
    slackTeamId,
  }: ReceiptRejectedEvent) {
    await this.jobs.enqueue<IReceiptRejectedDmJob>(RECEIPT_REJECTED_DM_JOB, {
      receiptId,
      slackTeamId,
    });
  }

  private async send({ receiptId, slackTeamId }: IReceiptRejectedDmJob) {
    const receipt = await this.receipts.findById(receiptId, slackTeamId);

    // Sent again, accepted or deleted before a retry: the message would be
    // out of date.
    if (
      !receipt ||
      receipt.status !== ReceiptStatus.Rejected ||
      !receipt.reimbursementId ||
      !receipt.month
    ) {
      return;
    }

    const [owner, reimbursement] = await Promise.all([
      // Not an inactive person: there is nobody to fix it.
      this.users.findOne({ id: receipt.userId, slackTeamId }),
      this.reimbursements.findById(receipt.reimbursementId, slackTeamId),
    ]);

    if (!owner || !reimbursement) {
      return;
    }

    await this.slackCommunicationService.postMessage(
      owner.slack_id,
      this.view.rejected(receipt, reimbursement),
      slackTeamId,
    );
  }
}
