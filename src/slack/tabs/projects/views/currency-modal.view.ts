import { Injectable } from '@nestjs/common';
import { AnyBlock } from '@slack/web-api';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IActionButtons,
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';

interface IGetViewParams extends IBaseModalViewParams {
  currency: string;
}

export interface ICurrencyModalViewMetadata {
  pageMetadata: string;
}

// The workspace's currency, for an admin to change.
@Injectable()
export class CurrencyModalView extends BaseModalView<
  IGetViewParams,
  ICurrencyModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.CurrencyFormSubmit;

  protected getTitleText(): string {
    return 'Currency';
  }

  protected getActionButtons(): IActionButtons {
    return {
      submit: { type: 'plain_text', text: 'Save' },
      close: { type: 'plain_text', text: 'Cancel' },
    };
  }

  public getViewBlocks({ currency, errorMessage }: IGetViewParams): AnyBlock[] {
    return [
      {
        type: 'input',
        block_id: 'currency_block',
        label: { type: 'plain_text', text: 'Currency code' },
        element: {
          type: 'plain_text_input',
          action_id: 'currency',
          initial_value: currency,
          min_length: 3,
          max_length: 3,
        },
        hint: {
          type: 'plain_text',
          text: 'The ISO 4217 code of the currency of all rates and amounts, such as USD, EUR or GBP. The rates keep their numbers: they are not converted.',
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
