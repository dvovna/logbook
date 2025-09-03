import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalViewService from 'src/slack/services/slack-views/modal-views/base-modal-view.service';
import { View } from '@slack/types/dist/views';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';

export interface IPolicyModalViewMetadata {
  policyIdToEdit: string | null;
}

interface IGetViewParams {
  policy: IVacationPolicyViewModel | null;
  errorMessage?: string;
}

@Injectable()
export class VacationPolicyModalViewService extends BaseModalViewService<IGetViewParams> {
  public getView({ policy, errorMessage }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.PolicyFormSubmit,
      private_metadata: JSON.stringify({
        policyIdToEdit: policy?.id,
      } as IPolicyModalViewMetadata),
      title: {
        type: 'plain_text',
        text: policy ? 'Edit Policy' : 'Create Policy',
      },
      submit: {
        type: 'plain_text',
        text: policy ? 'Save' : 'Create',
      },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
        {
          type: 'input',
          block_id: 'name_block',
          element: {
            type: 'plain_text_input',
            action_id: 'name',
            initial_value: policy?.name ?? '',
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
            initial_value: policy?.vacation_days?.toString() ?? '26',
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
            initial_value: policy?.working_days?.toString() ?? '20',
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
            initial_value: policy?.bonus_days?.toString() ?? '5',
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
            initial_value: policy?.carryover_days?.toString() || '0',
          },
          label: {
            type: 'plain_text',
            text: 'Carryover Days (from previous period)',
          },
        },
      ],
    };
  }
}
