import { Injectable, Logger } from '@nestjs/common';
import type { StaticSelectAction } from '@slack/bolt/dist/types/actions/block-action';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import HolidayImportService from '@modules/holidays/services/holiday-import.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { parseMetadata } from '@modules/slack/common/utils/slack-metadata.utils';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from '@modules/slack/tabs/holidays/services/holidays-tab.service';
import { IHolidaysTabMetadata } from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import {
  IMPORT_COUNTRY_ACTION_ID,
  IUploadCountryHolidaysModalViewMetadata,
} from '@modules/slack/tabs/holidays/views/import-holidays-modal.view';
import { COUNTRY_OPTIONS } from '@modules/slack/tabs/holidays/views/options/country.options';
import { jsonParse } from '@common/utils/json-parse';
import { runInBackground } from '@common/utils/run-in-background';

// A country chosen in the import form brings its regions into the form, read
// from Nager.Date after the answer, which can take longer than Slack waits.
// An older choice's rebuild fails (hash_conflict) instead of replacing a
// newer one.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ImportHolidays,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ImportHolidaysFormActionHandler extends BaseActionHandler {
  private readonly logger = new Logger(ImportHolidaysFormActionHandler.name);

  protected actionMap: ActionMapType = {
    [IMPORT_COUNTRY_ACTION_ID]: (payload, user) => {
      runInBackground(this.logger, 'show the regions of a country', () =>
        this.showRegions(payload, user),
      );
    },
  };

  public constructor(
    private readonly holidaysTabService: HolidaysTabService,
    private readonly holidayImportService: HolidayImportService,
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {
    super();
  }

  // The country comes from the client: one the form offers, or nothing
  // changes.
  private async showRegions(
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) {
    const country = (payload.actions[0] as StaticSelectAction).selected_option
      ?.value;
    const metadata =
      parseMetadata<IUploadCountryHolidaysModalViewMetadata>(payload);
    const year = jsonParse<IHolidaysTabMetadata>(metadata.pageMetadata)?.filters
      .selectedYear;

    if (
      !country ||
      !year ||
      !payload.view?.id ||
      !COUNTRY_OPTIONS.some(({ value }) => value === country)
    ) {
      return;
    }

    const regions = await this.holidayImportService.regions(country, year);

    await this.slackCommunicationService.updateView(
      payload.view.id,
      await this.holidaysTabService.getModalView(
        HolidaysTabModalName.ImportHolidays,
        {
          user,
          pageMetadata: metadata.pageMetadata,
          regions: {
            country,
            regions,
            version: `${country}.${Date.now().toString(36)}`,
          },
        },
      ),
      user.slack_team_id,
      payload.view.hash,
    );
  }
}
