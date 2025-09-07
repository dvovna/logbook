import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { HolidayModalView } from 'src/slack/tabs/holidays/views/holiday-modal.view';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/tabs/holidays/services/holidays-tab.service';
import { IHolidaysTabMetadata } from 'src/slack/tabs/holidays/views/holidays-tab.view';
import { IUploadCountryHolidaysModalViewMetadata } from 'src/slack/tabs/holidays/views/import-holidays-modal.view';
import ImportHolidaysModalViewValuesParser, {
  IImportHolidaysFormData,
} from 'src/slack/tabs/holidays/parsers/import-holidays-modal-view-values.parser';
import HolidayImportService from 'src/holidays/services/holiday-import.service';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ImportHolidays,
  type: 'view_submission',
})
export class ImportHolidaysFormSubmitHandler extends BaseModalFormSubmitHandler<
  IUploadCountryHolidaysModalViewMetadata,
  IImportHolidaysFormData,
  number
> {
  private readonly logger: Logger = new Logger(
    ImportHolidaysFormSubmitHandler.name,
  );

  public constructor(
    private readonly holidayModalViewService: HolidayModalView,
    private readonly holidayImportService: HolidayImportService,
    private readonly holidaysTabService: HolidaysTabService,
    importHolidaysModalViewValuesParser: ImportHolidaysModalViewValuesParser,
  ) {
    super(importHolidaysModalViewValuesParser);
  }

  public async onSubmit(
    data: IImportHolidaysFormData,
    metadata: IUploadCountryHolidaysModalViewMetadata,
    user: IUserViewModel,
  ) {
    const parsedPageMetadata = JSON.parse(
      metadata.pageMetadata,
    ) as IHolidaysTabMetadata;

    const holidaysCreated = await this.holidayImportService.import(
      {
        policyId: parsedPageMetadata.filters.policyId,
        countryCode: data.country.value,
        year: parsedPageMetadata.filters.selectedYear,
        slackTeamId: user.slack_team_id,
      },
      user,
    );

    this.holidaysTabService.publish({
      user,
      metadata: {
        ...parsedPageMetadata,
        page: 1,
      },
    });

    return holidaysCreated;
  }

  protected successResponse(holidaysCreated: number): ViewResponseAction {
    return SlackViewResponseFactory.update(
      this.holidayModalViewService.getSuccessView(
        `✅ ${holidaysCreated} holidays were imported successfully!`,
      ),
    );
  }

  protected async errorResponse(
    error: unknown,
    _formData: IImportHolidaysFormData,
    metadata: IUploadCountryHolidaysModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.error(error);

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
          pageMetadata: metadata.pageMetadata,
        },
      ),
    );
  }
}
