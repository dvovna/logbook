import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MAX_RECEIPT_REJECTION_REASON_LENGTH } from 'src/receipts/constants/receipt-limits';

interface IRejectReceiptParams extends IBaseModalViewParams {
  // Plain text: escaped here.
  fileName: string;
  ownerName: string;
  // What the receipt says, e.g. '$30.00'.
  amount: string | null;
}

export interface IRejectReceiptMetadata {
  id: string;
  // The screen to show again after the decision.
  pageMetadata?: string;
}

@Injectable()
export class RejectReceiptModalView extends BaseModalView<
  IRejectReceiptParams,
  IRejectReceiptMetadata
> {
  protected defaultCallbackId = ViewCallbackId.RejectReceiptForm;

  protected getTitleText(): string {
    return 'Reject receipt';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Reject' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  protected getViewBlocks({
    fileName,
    ownerName,
    amount,
    errorMessage,
  }: IRejectReceiptParams): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${escapeMrkdwn(fileName)}* from *${escapeMrkdwn(ownerName)}*${amount ? ` · ${amount}` : ''}`,
        },
      },
      {
        type: 'input',
        block_id: 'reason_block',
        label: { type: 'plain_text', text: 'Reason' },
        hint: {
          type: 'plain_text',
          text: 'They get it in a message, with a button to fix the details.',
        },
        element: {
          type: 'plain_text_input',
          action_id: 'reason',
          multiline: true,
          max_length: MAX_RECEIPT_REJECTION_REASON_LENGTH,
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
