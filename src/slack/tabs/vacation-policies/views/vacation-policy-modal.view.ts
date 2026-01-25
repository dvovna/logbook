import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { AnyBlock } from '@slack/web-api';

export interface IVacationPolicyModalViewMetadata {
  id?: string | null;
  pageMetadata: string;
}

interface IGetViewParams extends IBaseModalViewParams {
  initialData?: {
    id: string;
    name: string;
    vacation_days: number;
    working_days: number;
    bonus_days: number;
    carryover_days: number;
  };
}

@Injectable()
export class VacationPolicyModalView extends BaseModalView<
  IGetViewParams,
  IVacationPolicyModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.VacationPolicyFormSubmit;

  protected getTitleText({ initialData }: IGetViewParams): string {
    return initialData ? 'Edit Policy' : 'Create Policy';
  }

  public getViewBlocks({
    initialData,
    errorMessage,
  }: IGetViewParams): AnyBlock[] {
    return [
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
          text: 'Max Carryover Days (from previous period)',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
