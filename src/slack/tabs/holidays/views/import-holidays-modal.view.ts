import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from 'src/slack/common/views/base-modal.view';
import { COUNTRY_OPTIONS } from 'src/slack/tabs/holidays/views/options/country.options';
import { AnyBlock } from '@slack/web-api';

type IGetViewParams = IBaseModalViewParams;

export interface IUploadCountryHolidaysModalViewMetadata {
  pageMetadata: string;
}

@Injectable()
export class ImportHolidaysModalView extends BaseModalView<
  IGetViewParams,
  IUploadCountryHolidaysModalViewMetadata
> {
  protected callbackId = ViewCallbackId.ImportHolidays;

  protected getTitleText(): string {
    return 'Upload Country Holidays';
  }

  public getViewBlocks({ errorMessage }: IGetViewParams): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':warning: *Attention*: Existing system holidays for this policy will be removed and replaced with the new set from the selected country. Custom company holidays will remain unchanged.',
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'country_block',
        label: { type: 'plain_text', text: 'Select Country' },
        element: {
          type: 'static_select',
          action_id: 'country',
          placeholder: { type: 'plain_text', text: 'Choose a country' },
          options: COUNTRY_OPTIONS,
        },
      },
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }
}
