import { Injectable } from '@nestjs/common';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { clip } from '@modules/slack/common/views/components/message-sections';
import { MAX_RECEIPT_COMMENT_LENGTH } from '@modules/slack/receipts/parsers/receipt-details.parser';
import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';
import {
  collectedMonth,
  monthLabel,
  offeredMonths,
} from 'src/receipts/utils/receipt-months';

export interface IReceiptDetailsMetadata {
  receiptId: string;
  // The DM message that waits for the details, replaced after the save.
  channel?: string;
  ts?: string;
  // The tab the form was opened from, to show again after the save.
  pageMetadata?: string;
}

interface IReceiptDetailsParams extends IBaseModalViewParams {
  receipt: IReceiptViewModel;
  reimbursements: IReimbursementViewModel[];
  today: string;
  currency: string;
}

// Slack's limit for the text of an option.
const MAX_OPTION_CHARACTERS = 75;

const option = (text: string, value: string): PlainTextOption => ({
  text: { type: 'plain_text', text: clip(text, MAX_OPTION_CHARACTERS) },
  value,
});

@Injectable()
export class ReceiptDetailsModalView extends BaseModalView<
  IReceiptDetailsParams,
  IReceiptDetailsMetadata
> {
  protected defaultCallbackId = ViewCallbackId.ReceiptDetailsForm;

  // Also the form that edits a receipt's details later.
  public build(
    params: IReceiptDetailsParams,
    metadata: IReceiptDetailsMetadata,
  ): View {
    return this.getView(params, metadata);
  }

  protected getTitleText(): string {
    return 'Receipt details';
  }

  protected getViewBlocks({
    receipt,
    reimbursements,
    today,
    currency,
    errorMessage,
  }: IReceiptDetailsParams): AnyBlock[] {
    const reimbursementOptions = reimbursements.map(({ id, name }) =>
      option(name, id),
    );
    // With one reimbursement there is nothing to choose; with several the
    // person chooses, unless the receipt already has one.
    const preset =
      reimbursements.find(({ id }) => id === receipt.reimbursementId) ??
      (reimbursements.length === 1 ? reimbursements[0] : undefined);
    const monthOptions = offeredMonths(today).map((month) =>
      option(monthLabel(month), month),
    );
    const month =
      receipt.month ?? (preset && collectedMonth(today, preset.dueDay));

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🧾 *${escapeMrkdwn(clip(receipt.fileName, MAX_OPTION_CHARACTERS))}*`,
        },
      },
      {
        type: 'input',
        block_id: 'reimbursement_block',
        label: { type: 'plain_text', text: 'Reimbursement' },
        element: {
          type: 'static_select',
          action_id: 'reimbursement',
          options: reimbursementOptions,
          initial_option: reimbursementOptions.find(
            ({ value }) => value === preset?.id,
          ),
        },
      },
      {
        type: 'input',
        block_id: 'month_block',
        label: { type: 'plain_text', text: 'Month' },
        element: {
          type: 'static_select',
          action_id: 'month',
          options: monthOptions,
          initial_option: monthOptions.find(({ value }) => value === month),
        },
      },
      {
        type: 'input',
        block_id: 'amount_block',
        label: { type: 'plain_text', text: `Amount (${currency})` },
        element: {
          type: 'plain_text_input',
          action_id: 'amount',
          placeholder: { type: 'plain_text', text: '45.50' },
          initial_value:
            receipt.amountCents === null
              ? undefined
              : (receipt.amountCents / 100).toFixed(2),
        },
      },
      {
        type: 'input',
        block_id: 'comment_block',
        optional: true,
        label: { type: 'plain_text', text: 'Comment' },
        element: {
          type: 'plain_text_input',
          action_id: 'comment',
          multiline: true,
          max_length: MAX_RECEIPT_COMMENT_LENGTH,
          initial_value: receipt.comment ?? undefined,
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
