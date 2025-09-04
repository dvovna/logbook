import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import SlackMetadataParser from 'src/slack/utils/slack-metadata.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ConfirmationModalViewService, {
  IConfirmationModalViewMetadata,
} from 'src/slack/services/slack-views/modal-views/confirmation-modal-view.service';
import { IHolidaysTabMetadata } from 'src/slack/services/slack-views/tab-views/holidays-tab-view.service';
import HolidaysService from 'src/holidays/holidays.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/services/holidays-tab.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ToggleHolidayStatus,
  type: 'view_submission',
})
export class ToggleHolidayStatusFormSubmitHandler {
  private logger: Logger = new Logger(
    ToggleHolidayStatusFormSubmitHandler.name,
  );

  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly holidaysTabService: HolidaysTabService,
    private readonly confirmationModalViewService: ConfirmationModalViewService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const metadata =
      SlackMetadataParser.parse<IConfirmationModalViewMetadata>(payload);
    const { entityId: holidayId } = metadata;
    const pageMetadata = JSON.parse(
      payload.view.private_metadata,
    ) as IHolidaysTabMetadata;

    try {
      const holidayToChange = await this.holidaysService.findOne({
        id: holidayId,
        slackTeamId: user.slack_team_id,
      });

      if (!holidayToChange) {
        return SlackViewResponseFactory.update(
          await this.holidaysTabService.getModalView(
            HolidaysTabModalName.ToggleHolidayStatus,
            {
              user,
              errorMessage: 'Holiday not found',
              holidayId,
              pageMetadata: metadata.pageMetadata,
            },
          ),
        );
      }

      const updatedHoliday = await this.holidaysService.update(
        {
          id: holidayId,
          slackTeamId: user.slack_team_id,
        },
        {
          isDisabled: !holidayToChange.is_disabled,
        },
        user,
      );

      this.holidaysTabService.publish({
        user,
        policyId: pageMetadata.policyId,
      });

      return SlackViewResponseFactory.update(
        this.confirmationModalViewService.getSuccessView(
          `✅ Holiday '${updatedHoliday.name}' has been successfully ${!updatedHoliday.is_disabled ? 'activated' : 'deactivated'}.`,
        ),
      );
    } catch (error) {
      const errorMessage =
        'An error occurred while changing holiday status. Please try again later.';

      this.logger.warn(
        `Error changing holiday status: ${error.message}`,
        error,
      );

      return SlackViewResponseFactory.update(
        await this.holidaysTabService.getModalView(
          HolidaysTabModalName.ToggleHolidayStatus,
          {
            holidayId,
            user,
            errorMessage,
            pageMetadata: metadata.pageMetadata,
          },
        ),
      );
    }
  }
}
