import { Injectable } from '@nestjs/common';
import { KnownBlock } from '@slack/types';
import { formatMoney } from '@common/utils/money.utils';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import {
  clip,
  section,
} from '@modules/slack/common/views/components/message-sections';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptActionId } from '@modules/slack/receipts/enums/receipt-action-id.enum';
import { monthLabel } from 'src/receipts/utils/receipt-months';
import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';

export interface IReceiptMessage {
  text: string;
  blocks: KnownBlock[];
}

// A file name is the sender's: cut before it is escaped, so that cutting
// can't split an entity.
const MAX_FILE_NAME_CHARACTERS = 100;

const fileOf = (receipt: IReceiptViewModel) =>
  escapeMrkdwn(clip(receipt.fileName, MAX_FILE_NAME_CHARACTERS));

const message = (text: string, extra: KnownBlock[] = []): IReceiptMessage => ({
  text,
  blocks: [section(text), ...extra],
});

@Injectable()
export class ReceivedReceiptMessageView {
  public waiting(receipt: IReceiptViewModel): IReceiptMessage {
    const button = (
      actionId: ReceiptActionId,
      text: string,
      style?: 'primary',
    ) => ({
      type: 'button' as const,
      action_id: actionId,
      value: receipt.id,
      text: { type: 'plain_text' as const, text },
      ...(style ? { style } : {}),
    });

    return message(
      `🧾 Got your receipt *${fileOf(receipt)}*. Add the details so Finance can check it.`,
      [
        {
          type: 'actions',
          block_id: ViewCallbackId.ReceivedReceiptMessage,
          elements: [
            button(ReceiptActionId.AddDetails, 'Add details', 'primary'),
            button(ReceiptActionId.Discard, 'Discard'),
          ],
        },
      ],
    );
  }

  public sent(
    receipt: IReceiptViewModel,
    reimbursement: IReimbursementViewModel,
    currency: string,
  ): IReceiptMessage {
    const parts = [
      `*${fileOf(receipt)}*`,
      escapeMrkdwn(clip(reimbursement.name, MAX_FILE_NAME_CHARACTERS)),
      ...(receipt.month ? [monthLabel(receipt.month)] : []),
      ...(receipt.amountCents === null
        ? []
        : [formatMoney(receipt.amountCents, currency)]),
    ];

    return message(`🧾 ${parts.join(' · ')} — sent to Finance.`);
  }

  public discarded(receipt: IReceiptViewModel): IReceiptMessage {
    return message(`🗑 Discarded *${fileOf(receipt)}*.`);
  }
}
