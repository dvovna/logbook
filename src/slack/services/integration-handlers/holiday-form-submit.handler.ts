import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  HolidayModalViewService,
  IHolidayModalViewMetadata,
} from 'src/slack/services/slack-views/modal-views/holiday-modal-view.service';
import HolidaysService from 'src/holidays/holidays.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/services/holidays-tab.service';
import { IHolidaysTabMetadata } from 'src/slack/services/slack-views/tab-views/holidays-tab-view.service';
import HolidayModalViewValuesParser, {
  IHolidayFormViewData,
} from 'src/slack/services/slack-views/parsers/holiday-modal-view-values.parser';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.HolidayFormSubmit,
  type: 'view_submission',
})
export class HolidayFormSubmitHandler {
  public constructor(
    private readonly holidayModalViewValuesParser: HolidayModalViewValuesParser,
    private readonly holidayModalViewService: HolidayModalViewService,
    private readonly holidaysService: HolidaysService,
    private readonly holidaysTabService: HolidaysTabService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IHolidayModalViewMetadata>(payload);

    const { view } = payload;
    const { holidayIdToEdit, pageMetadata } = metadata;
    const { policyId } = JSON.parse(pageMetadata) as IHolidaysTabMetadata;

    const { data, errors } = this.holidayModalViewValuesParser.parse(
      view.state.values,
    );

    if (errors) {
      return SlackViewResponseFactory.errors(errors);
    }

    try {
      const holiday = await this.createOrUpdateHoliday(
        data,
        holidayIdToEdit,
        policyId,
        user,
      );

      this.holidaysTabService.publish({ user, policyId });

      return SlackViewResponseFactory.update(
        this.holidayModalViewService.getSuccessView(
          `✅ Holiday '${holiday.name}' was ${holidayIdToEdit ? 'updated' : 'created'} successfully!`,
        ),
      );
    } catch (error) {
      const errorMessage =
        error instanceof MaxItemsCountReachedError
          ? error.message
          : 'An error occurred while creating or updating the holiday. Please try again later.';

      return SlackViewResponseFactory.update(
        await this.holidaysTabService.getModalView<
          | HolidaysTabModalName.CreateHoliday
          | HolidaysTabModalName.UpdateHoliday
        >(
          holidayIdToEdit
            ? HolidaysTabModalName.UpdateHoliday
            : HolidaysTabModalName.CreateHoliday,
          {
            user,
            errorMessage,
            pageMetadata,
            ...(holidayIdToEdit ? { holidayId: holidayIdToEdit } : {}),
          },
        ),
      );
    }
  }

  private createOrUpdateHoliday(
    data: IHolidayFormViewData,
    holidayIdToEdit: string | null,
    policyId: string,
    user: IUserViewModel,
  ) {
    if (holidayIdToEdit) {
      return this.holidaysService.update(
        {
          id: holidayIdToEdit,
          slackTeamId: user.slack_team_id,
        },
        {
          name: data.name,
          date: data.date,
        },
        user,
      );
    }

    return this.holidaysService.create(
      {
        name: data.name,
        date: data.date,
        slackTeamId: user.slack_team_id,
        vacationPolicyId: policyId,
        isCompanyCustom: true,
      },
      user,
    );
  }
}
