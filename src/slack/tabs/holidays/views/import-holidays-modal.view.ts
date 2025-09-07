import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import BaseModalView from 'src/slack/common/views/base-modal.view';
import { View } from '@slack/types/dist/views';
import { COUNTRY_OPTIONS } from 'src/slack/tabs/holidays/views/options/country.options';

interface IGetViewParams {
  pageMetadata: string;
  errorMessage?: string;
}

export interface IUploadCountryHolidaysModalViewMetadata {
  pageMetadata: string;
}

@Injectable()
export class ImportHolidaysModalView extends BaseModalView<IGetViewParams> {
  public getView({ errorMessage, pageMetadata }: IGetViewParams): View {
    return {
      type: 'modal',
      callback_id: ViewCallbackId.ImportHolidays,
      private_metadata: JSON.stringify({
        pageMetadata,
      } as IUploadCountryHolidaysModalViewMetadata),
      title: {
        type: 'plain_text',
        text: 'Upload Country Holidays',
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
      ],
    };
  }
}
