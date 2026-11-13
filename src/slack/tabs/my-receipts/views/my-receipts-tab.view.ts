import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { formatMoney } from '@common/utils/money.utils';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';
import { monthLabel } from '@modules/receipts/utils/receipt-months';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import {
  detail,
  ListItem,
} from '@modules/slack/common/views/components/list-item.view';
import {
  RECEIPT_STATUS_LABELS,
  withIcon,
} from '@modules/slack/common/views/data/labels';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MyReceiptsActionId } from '@modules/slack/tabs/my-receipts/enums/my-receipts-action-id.enum';

interface IGetViewParams extends IBaseTabViewParams {
  receipts: IReceiptViewModel[];
  // Names by ID, archived reimbursements included.
  reimbursementNames: Map<string, string>;
  currency: string;
  // More than the screen shows.
  hiddenCount: number;
}

// Slack takes 100 blocks in a view: an item is two and its month's heading a
// third, and the header and the intro take a few more.
export const MAX_SHOWN_RECEIPTS = 25;

@Injectable()
export class MyReceiptsTabView extends BaseTabView<IGetViewParams, never> {
  protected callbackId = ViewCallbackId.MyReceiptsTabView;

  protected getTabTitle() {
    return `*${SCREENS[ScreenId.MyReceipts].title}*`;
  }

  protected getContentBlocks({
    receipts,
    reimbursementNames,
    currency,
    hiddenCount,
  }: IGetViewParams): AnyBlock[] {
    const blocks: AnyBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Send a photo or PDF of a receipt to Logbook in Messages to add one.',
        },
      },
    ];
    let group: string | undefined;

    for (const receipt of receipts) {
      // A draft has no month yet.
      const heading = receipt.month
        ? monthLabel(receipt.month)
        : 'Needs details';

      if (heading !== group) {
        group = heading;
        blocks.push({
          type: 'context',
          elements: [{ type: 'mrkdwn', text: `*${heading}*` }],
        });
      }

      blocks.push(
        ...ListItem.getBlocks({
          title: receipt.fileName,
          details: [
            detail(
              'Reimbursement',
              receipt.reimbursementId &&
                escapeMrkdwn(
                  reimbursementNames.get(receipt.reimbursementId) ?? '',
                ),
            ),
            detail(
              'Amount',
              receipt.amountCents === null
                ? null
                : formatMoney(receipt.amountCents, currency),
            ),
            detail('Status', withIcon(RECEIPT_STATUS_LABELS[receipt.status])),
            detail(
              'Reason',
              receipt.rejectionReason && escapeMrkdwn(receipt.rejectionReason),
            ),
          ],
          accessory: this.menuOf(receipt),
        }),
      );
    }

    if (hiddenCount) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `${hiddenCount} older ${hiddenCount === 1 ? 'receipt is' : 'receipts are'} not shown.`,
          },
        ],
      });
    }

    return blocks;
  }

  // An accepted receipt is Finance's now: nothing to do with it.
  private menuOf({
    id,
    status,
  }: IReceiptViewModel): SectionBlockAccessory | undefined {
    if (status === ReceiptStatus.Accepted) {
      return undefined;
    }

    return {
      type: 'overflow',
      action_id: MyReceiptsActionId.ManageReceiptMenu,
      options: [
        {
          text: {
            type: 'plain_text',
            text: status === ReceiptStatus.Draft ? 'Add details' : 'Edit',
          },
          value: `${MyReceiptsActionId.EditReceipt}:${id}`,
        },
        {
          text: { type: 'plain_text', text: 'Delete' },
          value: `${MyReceiptsActionId.DeleteReceipt}:${id}`,
        },
      ],
    };
  }
}
