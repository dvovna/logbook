import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/confirmation-modal.view';
import { IHolidaysTabMetadata } from 'src/slack/tabs/holidays/views/holidays-tab.view';
import HolidaysService from 'src/holidays/services/holidays.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/tabs/holidays/services/holidays-tab.service';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { jsonParse } from 'src/common/utils/json-parse';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ToggleHolidayStatus,
  type: 'view_submission',
})
export class ToggleHolidayStatusFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  object,
  { name: string; isDisabled: boolean }
> {
  private readonly logger = new Logger(
    ToggleHolidayStatusFormSubmitHandler.name,
  );

  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly holidaysTabService: HolidaysTabService,
    private readonly confirmationModalViewService: ConfirmationModalView,
  ) {
    super();
  }

  protected async onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<{ name: string; isDisabled: boolean }> {
    const { id: holidayId } = meta;

    const holidayToChange = await this.holidaysService.findOne({
      id: holidayId,
      slackTeamId: user.slack_team_id,
    });

    if (!holidayToChange) {
      throw new Error('Holiday not found');
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

    return {
      name: updatedHoliday.name,
      isDisabled: updatedHoliday.is_disabled,
    };
  }

  protected successResponse(
    entity: { name: string; isDisabled: boolean },
    user: IUserViewModel,
    metadata: IConfirmationModalViewMetadata,
  ): ViewResponseAction {
    const pageMetadata = jsonParse<IHolidaysTabMetadata>(metadata.pageMetadata);

    if (!pageMetadata) {
      throw new Error('Page metadata is required');
    }

    this.holidaysTabService.publish({
      user,
      metadata: pageMetadata,
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalViewService.getSuccessView(
        `✅ Holiday '${entity.name}' has been successfully ${
          !entity.isDisabled ? 'activated' : 'deactivated'
        }.`,
      ),
    );
  }

  protected async errorResponse(
    error: unknown,
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'An error occurred while changing holiday status. Please try again later.';

    this.logger.warn(
      `Error changing holiday status: ${errorMessage}`,
      error instanceof Error ? error : undefined,
    );

    return SlackViewResponseFactory.update(
      await this.holidaysTabService.getModalView(
        HolidaysTabModalName.ToggleHolidayStatus,
        {
          holidayId: meta.id,
          user,
          errorMessage,
          pageMetadata: meta.pageMetadata,
        },
      ),
    );
  }
}
