import { TIME_REMINDER_LABELS } from '@modules/slack/common/views/data/labels';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
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
  timeReminder: TimeReminder;
}

export interface IRemindersMetadata {
  // The reimbursements the form shows: only those are changed on submit.
  shownIds: string[];
}

export const REMINDED_BLOCK_ID = 'reminded_block';
export const REMINDED_ACTION_ID = 'reminded';
export const TIME_REMINDER_BLOCK_ID = 'time_reminder_block';
export const TIME_REMINDER_ACTION_ID = 'timeReminder';

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
    timeReminder,
    errorMessage,
  }: IRemindersParams): AnyBlock[] {
    const timeOptions: PlainTextOption[] = (
      Object.keys(TIME_REMINDER_LABELS) as TimeReminder[]
    ).map((value) => ({
      text: { type: 'plain_text', text: TIME_REMINDER_LABELS[value] },
      value,
    }));
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
        block_id: TIME_REMINDER_BLOCK_ID,
        label: {
          type: 'plain_text',
          text: "Remind me about time I haven't submitted",
        },
        element: {
          type: 'static_select',
          action_id: TIME_REMINDER_ACTION_ID,
          options: timeOptions,
          initial_option: timeOptions.find(
            ({ value }) => value === timeReminder,
          ),
        },
      },
      // Only a workspace that collects receipts has something to choose.
      ...(options.length
        ? [
            {
              type: 'input',
              block_id: REMINDED_BLOCK_ID,
              optional: true,
              label: {
                type: 'plain_text',
                text: 'Remind me about receipts for',
              },
              element: {
                type: 'checkboxes',
                action_id: REMINDED_ACTION_ID,
                options,
                // Slack refuses an empty list.
                ...(checked.length && { initial_options: checked }),
              },
            } as AnyBlock,
          ]
        : []),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
