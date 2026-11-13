import { Injectable } from '@nestjs/common';
import { formatDate } from '@common/utils/date.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  RECEIPT_STATUS_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import { ReceivedReceiptMessageView } from '@modules/slack/receipts/views/received-receipt-message.view';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { MAX_RECEIPT_FILE_BYTES } from 'src/receipts/constants/receipt-limits';
import { RECEIPT_ADMIN_ROLES } from 'src/receipts/constants/receipt-roles';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';

export interface ISharedReceiptFile {
  id: string;
  name: string;
  size: number;
  mimetype: string;
  url: string;
}

@Injectable()
export class ReceiptIntakeService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly receipts: ReceiptsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly view: ReceivedReceiptMessageView,
  ) {}

  // A file the sender shared in their DM with the app. The slack event is a
  // job, so a failure after the file was stored is retried: `again` is that
  // retry (or a second delivery).
  public async handle(
    file: ISharedReceiptFile,
    user: IUserViewModel,
  ): Promise<void> {
    const active = await this.reimbursements.findActive(user.slack_team_id);

    if (!active.length) {
      return this.reply(
        user,
        `There are no reimbursements to send receipts for yet.${
          RECEIPT_ADMIN_ROLES.includes(user.role)
            ? ' Add one in More → Receipts → Reimbursements.'
            : ''
        }`,
      );
    }

    if (file.size > MAX_RECEIPT_FILE_BYTES) {
      return this.reply(
        user,
        '❗️ The file is larger than 10 MB. Send a smaller photo or PDF.',
      );
    }

    const content = await this.slackCommunicationService.fetchFileBytes(
      file.url,
      user.slack_team_id,
      MAX_RECEIPT_FILE_BYTES,
    );
    const { outcome, receipt } = await this.receipts.receive({
      user,
      slackFileId: file.id,
      fileName: file.name,
      mimeType: file.mimetype,
      content,
    });

    if (outcome === 'duplicate') {
      return this.reply(
        user,
        `You already sent this file on ${formatDate(receipt.createdAt)} (${withIcon(RECEIPT_STATUS_LABELS[receipt.status])}).`,
      );
    }

    // A second run of a file whose receipt is still a draft: the first one
    // failed before or while posting. Whether its message exists is not
    // known (that would take scopes the app doesn't ask for).
    if (outcome === 'again' && receipt.status !== ReceiptStatus.Draft) {
      return;
    }

    await this.postWaiting(user, receipt);
  }

  private async postWaiting(user: IUserViewModel, receipt: IReceiptViewModel) {
    await this.slackCommunicationService.postMessage(
      user.slack_id,
      this.view.waiting(receipt),
      user.slack_team_id,
    );
  }

  private reply(user: IUserViewModel, text: string) {
    return this.slackCommunicationService.postEphemeral(
      user.slack_id,
      { text },
      user.slack_team_id,
    );
  }
}
