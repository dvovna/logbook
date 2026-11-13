import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { formatMoney } from '@common/utils/money.utils';
import { SCREENS, ScreenId } from '@modules/slack/common/navigation/screens';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { ListItem } from '@modules/slack/common/views/components/list-item.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ReceiptsTabActionId } from '@modules/slack/tabs/receipts/enums/receipts-tab-action-id.enum';
import { IReceiptsTabMetadata } from '@modules/slack/tabs/receipts/views/receipts-tab.view';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';

interface IGetViewParams extends IBaseTabViewParams {
  // The active ones.
  reimbursements: IReimbursementViewModel[];
  currency: string;
}

// What people send receipts for: add, change and archive.
@Injectable()
export class ReimbursementsView extends BaseTabView<
  IGetViewParams,
  IReceiptsTabMetadata
> {
  protected callbackId = ViewCallbackId.ReceiptsTabView;

  protected getTabTitle(): string {
    return `*${SCREENS[ScreenId.Reimbursements].title}*\nWhat people send receipts for, the day each month's receipts are due and the most a person gets back.`;
  }

  protected getTitleAccessory(): SectionBlockAccessory {
    return {
      type: 'button',
      text: { type: 'plain_text', text: '➕ Add reimbursement', emoji: true },
      action_id: ReceiptsTabActionId.AddReimbursement,
    };
  }

  protected getContentBlocks({
    reimbursements,
    currency,
  }: IGetViewParams): AnyBlock[] {
    if (!reimbursements.length) {
      return [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '_No reimbursements yet._ Add one, for example a gym or lunches.',
          },
        },
      ];
    }

    return reimbursements.flatMap((reimbursement) =>
      ListItem.getBlocks({
        title: reimbursement.name,
        details: [
          `Due: day ${reimbursement.dueDay} of the next month`,
          `Limit: ${
            reimbursement.limitCents === null
              ? 'none'
              : `${formatMoney(reimbursement.limitCents, currency)} per person and month`
          }`,
        ],
        accessory: {
          type: 'overflow',
          action_id: ReceiptsTabActionId.ManageReimbursementMenu,
          options: [
            {
              text: { type: 'plain_text', text: 'Edit' },
              value: `${ReceiptsTabActionId.EditReimbursement}:${reimbursement.id}`,
            },
            {
              text: { type: 'plain_text', text: 'Archive' },
              value: `${ReceiptsTabActionId.ArchiveReimbursement}:${reimbursement.id}`,
            },
          ],
        },
      }),
    );
  }
}
