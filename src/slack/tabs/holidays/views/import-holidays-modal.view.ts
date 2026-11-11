import { Injectable } from '@nestjs/common';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import BaseModalView, {
  IBaseModalViewParams,
} from '@modules/slack/common/views/base-modal.view';
import { COUNTRY_OPTIONS } from '@modules/slack/tabs/holidays/views/options/country.options';
import { versionedBlockId } from '@modules/slack/services/slack-view-values.parser';
import { AnyBlock, PlainTextOption } from '@slack/web-api';

interface IGetViewParams extends IBaseModalViewParams {
  year: number;
}

export interface IUploadCountryHolidaysModalViewMetadata {
  pageMetadata: string;
  // The regions of the country chosen, once the form shows them; a form
  // shown again after an error keeps them.
  regions?: IImportRegions;
}

export interface IImportRegions {
  country: string;
  regions: string[];
  // A new one for each country, so that Slack doesn't keep the region of
  // the country chosen before (views.update keeps what a field with the same
  // block_id holds).
  version: string;
}

export const IMPORT_COUNTRY_ACTION_ID = 'country';
export const IMPORT_REGION_ACTION_ID = 'region';
export const WHOLE_COUNTRY = 'whole_country';

@Injectable()
export class ImportHolidaysModalView extends BaseModalView<
  IGetViewParams,
  IUploadCountryHolidaysModalViewMetadata
> {
  protected defaultCallbackId = ViewCallbackId.ImportHolidays;

  protected getTitleText(): string {
    return 'Upload Country Holidays';
  }

  public getViewBlocks(
    { errorMessage, year }: IGetViewParams,
    metadata?: IUploadCountryHolidaysModalViewMetadata,
  ): AnyBlock[] {
    const regions = metadata?.regions;

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:warning: *Attention*: The country holidays of ${year} for this policy will be replaced with the public holidays of the selected country, and of its region if you choose one. Custom company holidays will remain unchanged.`,
        },
      },
      {
        type: 'divider',
      },
      {
        type: 'input',
        block_id: 'country_block',
        dispatch_action: true,
        label: { type: 'plain_text', text: 'Select Country' },
        element: {
          type: 'static_select',
          action_id: IMPORT_COUNTRY_ACTION_ID,
          placeholder: { type: 'plain_text', text: 'Choose a country' },
          options: COUNTRY_OPTIONS,
        },
      },
      ...(regions?.regions.length ? [this.getRegionBlock(regions)] : []),
      ...(errorMessage ? [this.getGeneralErrorBlock(errorMessage)] : []),
    ];
  }

  private getRegionBlock({ regions, version }: IImportRegions): AnyBlock {
    const options: PlainTextOption[] = [
      {
        text: { type: 'plain_text', text: 'Only the whole country' },
        value: WHOLE_COUNTRY,
      },
      ...regions.map((region) => ({
        text: { type: 'plain_text' as const, text: region },
        value: region,
      })),
    ];

    return {
      type: 'input',
      block_id: versionedBlockId('region_block', version),
      label: { type: 'plain_text', text: 'Region' },
      hint: {
        type: 'plain_text',
        text: "Some holidays are days off only in a region. Choose the region where the policy's people work to import its holidays too.",
      },
      element: {
        type: 'static_select',
        action_id: IMPORT_REGION_ACTION_ID,
        options,
        initial_option: options[0],
      },
    };
  }
}
