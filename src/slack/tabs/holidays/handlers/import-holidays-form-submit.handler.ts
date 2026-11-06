import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from '@modules/slack/tabs/holidays/services/holidays-tab.service';
import { IHolidaysTabMetadata } from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import {
  ImportHolidaysModalView,
  IUploadCountryHolidaysModalViewMetadata,
} from '@modules/slack/tabs/holidays/views/import-holidays-modal.view';
import ImportHolidaysModalViewValuesParser, {
  IImportHolidaysFormData,
} from '@modules/slack/tabs/holidays/parsers/import-holidays-modal-view-values.parser';
import HolidayImportService from '@modules/holidays/services/holiday-import.service';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ImportHolidays,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ImportHolidaysFormSubmitHandler extends BaseModalFormSubmitHandler<
  IUploadCountryHolidaysModalViewMetadata,
  IImportHolidaysFormData,
  number
> {
  public constructor(
    private readonly importHolidaysModalView: ImportHolidaysModalView,
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
      this.importHolidaysModalView.getSuccessView(
        `✅ ${holidaysCreated} holidays were imported successfully!`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _formData: IImportHolidaysFormData,
    metadata: IUploadCountryHolidaysModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.error(errorMessage);

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
