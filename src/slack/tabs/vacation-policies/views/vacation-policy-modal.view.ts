import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalView from 'src/slack/common/views/base-modal.view';
import { View } from '@slack/types/dist/views';

export interface IVacationPolicyModalViewMetadata {
  id: string | null;
}

interface IGetViewParams {
  initialData?: {
    id: string;
    name: string;
    vacation_days: number;
    working_days: number;
    bonus_days: number;
    carryover_days: number;
  };
  errorMessage?: string;
}

@Injectable()
export class VacationPolicyModalView extends BaseModalView<IGetViewParams> {
  public getView({ initialData, errorMessage }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.VacationPolicyFormSubmit,
      private_metadata: JSON.stringify({
        id: initialData?.id,
      } as IVacationPolicyModalViewMetadata),
      title: {
        type: 'plain_text',
        text: initialData ? 'Edit Policy' : 'Create Policy',
      },
      submit: {
        type: 'plain_text',
        text: initialData ? 'Save' : 'Create',
      },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name',
            initial_value: initialData?.name ?? '',
          },
          label: {
            type: 'plain_text',
            text: 'Policy Name',
          },
        },
        {
          type: 'input',
          block_id: 'vacation_days_block',
          element: {
            type: 'number_input',
            action_id: 'vacation_days',
            is_decimal_allowed: false,
            min_value: '0',
            max_value: '30',
            initial_value: initialData?.vacation_days?.toString() ?? '26',
          },
          label: {
            type: 'plain_text',
            text: 'Vacation Days (Calendar)',
          },
        },
        {
          type: 'input',
          block_id: 'working_days_block',
          element: {
            type: 'number_input',
            action_id: 'working_days',
            is_decimal_allowed: false,
            min_value: '0',
            max_value: '30',
            initial_value: initialData?.working_days?.toString() ?? '20',
          },
          label: {
            type: 'plain_text',
            text: 'Vacation Days (Working)',
          },
        },
        {
          type: 'input',
          block_id: 'bonus_days_block',
          element: {
            type: 'number_input',
            action_id: 'bonus_days',
            is_decimal_allowed: false,
            min_value: '0',
            max_value: '30',
            initial_value: initialData?.bonus_days?.toString() ?? '5',
          },
          label: {
            type: 'plain_text',
            text: 'Bonus Days',
          },
        },
        {
          type: 'input',
          block_id: 'carryover_days_block',
          optional: true,
          element: {
            type: 'number_input',
            action_id: 'carryover_days',
            is_decimal_allowed: false,
            min_value: '0',
            max_value: '30',
            initial_value: initialData?.carryover_days?.toString() || '0',
          },
          label: {
            type: 'plain_text',
            text: 'Carryover Days (from previous period)',
          },
        },
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
      ],
    };
  }
}
