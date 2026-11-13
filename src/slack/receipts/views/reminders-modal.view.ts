import { Injectable } from '@nestjs/common';
import { AnyBlock, PlainTextOption } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { clip } from '@modules/slack/common/views/components/message-sections';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';

interface IRemindersParams extends IBaseModalViewParams {
  // Active ones: at most 10, Slack's limit for a checkbox group.
  reimbursements: IReimbursementViewModel[];
  optedOutIds: string[];
}

export interface IRemindersMetadata {
  // The reimbursements the form shows: only those are changed on submit.
  shownIds: string[];
}

export const REMINDED_BLOCK_ID = 'reminded_block';
export const REMINDED_ACTION_ID = 'reminded';

// Slack's limit for the text of an option.
const MAX_OPTION_CHARACTERS = 75;

@Injectable()
export class RemindersModalView extends BaseModalView<
  IRemindersParams,
  IRemindersMetadata
> {
  protected defaultCallbackId = ViewCallbackId.RemindersForm;

  public build(params: IRemindersParams) {
    return this.getView(params, {
      shownIds: params.reimbursements.map(({ id }) => id),
    });
  }

  protected getTitleText(): string {
    return 'Reminders';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  protected getViewBlocks({
    reimbursements,
    optedOutIds,
    errorMessage,
  }: IRemindersParams): AnyBlock[] {
    const options: PlainTextOption[] = reimbursements.map(({ id, name }) => ({
      text: { type: 'plain_text', text: clip(name, MAX_OPTION_CHARACTERS) },
      value: id,
    }));
    const checked = options.filter(
      ({ value }) => !optedOutIds.includes(value as string),
    );

    return [
      {
        type: 'input',
        block_id: REMINDED_BLOCK_ID,
        optional: true,
        label: { type: 'plain_text', text: 'Remind me about receipts for' },
        element: {
          type: 'checkboxes',
          action_id: REMINDED_ACTION_ID,
          options,
          // Slack refuses an empty list.
          ...(checked.length && { initial_options: checked }),
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'Reminders about logging time will be set here too.',
          },
        ],
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
