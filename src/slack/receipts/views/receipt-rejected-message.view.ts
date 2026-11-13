import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { section } from '@modules/slack/common/views/components/message-sections';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { IReceiptMessage } from '@modules/slack/receipts/views/received-receipt-message.view';
import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';
import { monthLabel } from 'src/receipts/utils/receipt-months';

@Injectable()
export class ReceiptRejectedMessageView {
  public rejected(
    receipt: IReceiptViewModel,
    reimbursement: IReimbursementViewModel,
  ): IReceiptMessage {
    // The reason is Finance's words: escaped, so that it can't become a
    // link or a mention.
    const text = [
      `❌ Your receipt *${escapeMrkdwn(receipt.fileName)}* for ${escapeMrkdwn(reimbursement.name)}, ${monthLabel(receipt.month as string)} was rejected: ${escapeMrkdwn(receipt.rejectionReason)}`,
      'Fix the details, or send a new photo or PDF here if the file was the problem.',
    ].join('\n');

    return {
      text,
      blocks: [
        section(text),
        {
          type: 'actions',
          block_id: ViewCallbackId.ReceiptRejectedMessage,
          elements: [
            {
              type: 'button',
              action_id: ReceiptActionId.EditDetails,
              value: receipt.id,
              text: { type: 'plain_text', text: 'Edit details' },
              style: 'primary',
            },
          ],
        },
      ],
    };
  }
}
