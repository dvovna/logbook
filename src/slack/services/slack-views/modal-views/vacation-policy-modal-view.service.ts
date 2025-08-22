import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
import { View } from '@slack/types/dist/views';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';

// const vacationPolicyFormSchema = z.object({
//   vacation_days: z
//     .string()
//     .transform((value) => parseInt(value, 10))
//     .refine((value) => !isNaN(value), {
//       message: 'Vacation days must be a number',
//     }),
//   bonus_days: z
//     .string()
//     .transform((value) => parseInt(value, 10))
//     .refine((value) => !isNaN(value), {
//       message: 'Bonus days must be a number',
//     }),
// });

interface IGetViewParams {
  policy: IVacationPolicyViewModel | null;
  generalError?: string;
}

@Injectable()
export class VacationPolicyModalViewService extends BaseModalViewService<IGetViewParams> {
  public getView({ policy, generalError }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.VacationPolicyManagement,
      title: {
        type: 'plain_text',
        text: 'Team Vacation Settings',
      },
      submit: {
        type: 'plain_text',
        text: 'Save',
      },
      close: {
        type: 'plain_text',
        text: 'Cancel',
      },
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '👋 Hello! Thank you for installing the Marina Bot.\n\nBefore we get started, please configure the number of vacation and bonus days for your team.',
          },
        },
        {
          type: 'divider',
        },
        {
          type: 'input',
          block_id: 'vacation_days_block',
          label: {
            type: 'plain_text',
            text: 'Number of vacation days per year',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'vacation_days',
            placeholder: {
              type: 'plain_text',
              text: 'e.g. 20',
            },
            initial_value: policy?.vacation_days.toString(),
          },
        },
        {
          type: 'input',
          block_id: 'bonus_days_block',
          label: {
            type: 'plain_text',
            text: 'Number of bonus days per year',
          },
          element: {
            type: 'plain_text_input',
            action_id: 'bonus_days',
            initial_value: policy?.bonus_days.toString(),
            placeholder: {
              type: 'plain_text',
              text: 'e.g. 3',
            },
          },
        },
      ],
    };
  }
}
