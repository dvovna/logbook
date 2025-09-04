import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { HolidayModalViewService } from 'src/slack/services/slack-views/modal-views/holiday-modal-view.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/services/holidays-tab.service';
import { IHolidaysTabMetadata } from 'src/slack/services/slack-views/tab-views/holidays-tab-view.service';
import { IUploadCountryHolidaysModalViewMetadata } from 'src/slack/services/slack-views/modal-views/import-holidays-modal-view.service';
import ImportHolidaysModalViewValuesParser from 'src/slack/services/slack-views/parsers/import-holidays-modal-view-values.parser';
import HolidayImportService from 'src/holidays/holiday-import.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ImportHolidays,
  type: 'view_submission',
})
export class ImportHolidaysFormSubmitHandler {
  public constructor(
    private readonly importHolidaysModalViewValuesParser: ImportHolidaysModalViewValuesParser,
    private readonly holidayModalViewService: HolidayModalViewService,
    private readonly holidayImportService: HolidayImportService,
    private readonly holidaysTabService: HolidaysTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IUploadCountryHolidaysModalViewMetadata>(
        payload,
      );

    const { view } = payload;
    const { pageMetadata } = metadata;
    const { policyId, selectedYear } = JSON.parse(
      pageMetadata,
    ) as IHolidaysTabMetadata;

    const { data, errors } = this.importHolidaysModalViewValuesParser.parse(
      view.state.values,
    );

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const holidaysCreated = await this.holidayImportService.import(
        {
          policyId,
          countryCode: data.country,
          year: selectedYear,
          slackTeamId: user.slack_team_id,
        },
        user,
      );

      this.holidaysTabService.publish({ user, policyId });

      return SlackViewResponseFactory.update(
        this.holidayModalViewService.getSuccessView(
          `✅ ${holidaysCreated} holidays were imported successfully!`,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof MaxItemsCountReachedError
          ? error.message
          : 'An error occurred while creating or updating the holiday. Please try again later.';

      return SlackViewResponseFactory.update(
        await this.holidaysTabService.getModalView<HolidaysTabModalName.ImportHolidays>(
          HolidaysTabModalName.ImportHolidays,
          {
            user,
            errorMessage,
            pageMetadata,
          },
        ),
      );
    }
  }
}
