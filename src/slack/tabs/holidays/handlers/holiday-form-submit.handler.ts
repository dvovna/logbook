import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  HolidayModalView,
  IHolidayModalViewMetadata,
} from 'src/slack/tabs/holidays/views/holiday-modal.view';
import HolidaysService from 'src/holidays/services/holidays.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/tabs/holidays/services/holidays-tab.service';
import { IHolidaysTabMetadata } from 'src/slack/tabs/holidays/views/holidays-tab.view';
import HolidayModalViewValuesParser, {
  IHolidayFormViewData,
} from 'src/slack/tabs/holidays/parsers/holiday-modal-view-values.parser';
import { jsonParse } from 'src/common/utils/json-parse';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import IHolidayViewModel from 'src/holidays/types/holiday.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HolidayFormSubmit,
  type: 'view_submission',
})
export class HolidayFormSubmitHandler extends BaseModalFormSubmitHandler<
  IHolidayModalViewMetadata,
  IHolidayFormViewData,
  IHolidayViewModel
> {
  public constructor(
    private readonly holidayModalView: HolidayModalView,
    private readonly holidaysService: HolidaysService,
    private readonly holidaysTabService: HolidaysTabService,
    holidayModalViewValuesParser: HolidayModalViewValuesParser,
  ) {
    super(holidayModalViewValuesParser);
  }

  protected async onSubmit(
    data: IHolidayFormViewData,
    metadata: IHolidayModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel> {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, metadata, user);
  }

  private create(
    data: IHolidayFormViewData,
    metadata: IHolidayModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel> {
    const pageMetadata = jsonParse<IHolidaysTabMetadata>(metadata.pageMetadata);

    if (!pageMetadata) {
      throw new Error('pageMetadata not found');
    }

    return this.holidaysService.create(
      {
        name: data.name,
        date: data.date,
        slackTeamId: user.slack_team_id,
        vacationPolicyId: pageMetadata.filters.policyId,
        isCompanyCustom: true,
      },
      user,
    );
  }

  private update(
    id: string,
    data: IHolidayFormViewData,
    user: IUserViewModel,
  ): Promise<IHolidayViewModel> {
    return this.holidaysService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        name: data.name,
        date: data.date,
      },
      user,
    );
  }

  protected successResponse(
    holiday: IHolidayViewModel,
    user: IUserViewModel,
    metadata: IHolidayModalViewMetadata,
  ) {
    const pageMetadata = jsonParse<IHolidaysTabMetadata>(metadata.pageMetadata);

    if (!pageMetadata) {
      throw new Error('pageMetadata not found');
    }

    this.holidaysTabService.publish({
      user,
      metadata: pageMetadata,
    });

    return SlackViewResponseFactory.update(
      this.holidayModalView.getSuccessView(
        `✅ Holiday '${holiday.name}' was ${
          metadata.id ? 'updated' : 'created'
        } successfully!`,
      ),
    );
  }

  protected async errorResponse(
    error: Error,
    _data: IHolidayFormViewData,
    metadata: IHolidayModalViewMetadata,
    user: IUserViewModel,
  ) {
    const errorMessage =
      error instanceof MaxItemsCountReachedError
        ? error.message
        : `An error occurred while ${
          metadata.id ? 'updating' : 'creating'
        } the holiday. Please try again later.`;

    return SlackViewResponseFactory.update(
      await this.holidaysTabService.getModalView<
        HolidaysTabModalName.CreateHoliday | HolidaysTabModalName.UpdateHoliday
      >(
        metadata.id
          ? HolidaysTabModalName.UpdateHoliday
          : HolidaysTabModalName.CreateHoliday,
        {
          user,
          errorMessage,
          pageMetadata: metadata.pageMetadata,
          ...(metadata.id ? { holidayId: metadata.id } : {}),
        },
      ),
    );
  }
}
