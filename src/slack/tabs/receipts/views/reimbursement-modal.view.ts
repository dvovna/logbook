import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { MAX_REIMBURSEMENT_NAME_LENGTH } from '@modules/slack/tabs/receipts/parsers/reimbursement-modal.parser';

interface IReimbursementModalParams extends IBaseModalViewParams {
  // Set when the form edits one.
  editing: boolean;
  currency: string;
  name?: string;
  dueDay?: number;
  limitCents?: number | null;
}

export interface IReimbursementModalMetadata {
  // The reimbursement being edited; none for a new one.
  id?: string;
  pageMetadata?: string;
}

const DEFAULT_DUE_DAY = 5;

@Injectable()
export class ReimbursementModalView extends BaseModalView<
  IReimbursementModalParams,
  IReimbursementModalMetadata
> {
  protected defaultCallbackId = ViewCallbackId.ReimbursementForm;

  protected getTitleText(params?: IReimbursementModalParams): string {
    return params?.editing ? 'Edit reimbursement' : 'Add reimbursement';
  }

  protected getViewBlocks({
    currency,
    name,
    dueDay,
    limitCents,
    errorMessage,
  }: IReimbursementModalParams): AnyBlock[] {
    return [
      {
        type: 'input',
        block_id: 'name_block',
        label: { type: 'plain_text', text: 'Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'name',
          max_length: MAX_REIMBURSEMENT_NAME_LENGTH,
          initial_value: name,
        },
      },
      {
        type: 'input',
        block_id: 'due_day_block',
        label: { type: 'plain_text', text: 'Due day' },
        hint: {
          type: 'plain_text',
          text: 'Day of the following month, 1–28',
        },
        element: {
          type: 'number_input',
          action_id: 'dueDay',
          is_decimal_allowed: false,
          min_value: '1',
          max_value: '28',
          initial_value: String(dueDay ?? DEFAULT_DUE_DAY),
        },
      },
      {
        type: 'input',
        block_id: 'limit_block',
        optional: true,
        label: {
          type: 'plain_text',
          text: `Limit per person and month (${currency})`,
        },
        hint: { type: 'plain_text', text: 'Leave empty for no limit.' },
        element: {
          type: 'plain_text_input',
          action_id: 'limit',
          placeholder: { type: 'plain_text', text: '50.00' },
          initial_value:
            limitCents === null || limitCents === undefined
              ? undefined
              : (limitCents / 100).toFixed(2),
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
