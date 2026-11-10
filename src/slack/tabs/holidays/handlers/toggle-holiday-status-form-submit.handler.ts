import { Injectable, NotFoundException } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { IHolidaysTabMetadata } from '@modules/slack/tabs/holidays/views/holidays-tab.view';
import HolidaysService from '@modules/holidays/services/holidays.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from '@modules/slack/tabs/holidays/services/holidays-tab.service';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { jsonParse } from '@common/utils/json-parse';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ToggleHolidayStatus,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ToggleHolidayStatusFormSubmitHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  object,
  { name: string; isDisabled: boolean }
> {
  public constructor(
    private readonly holidaysService: HolidaysService,
    private readonly holidaysTabService: HolidaysTabService,
    private readonly confirmationModalView: ConfirmationModalView,
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
      throw new NotFoundException('Holiday not found');
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
    const pageMetadata = jsonParse<IHolidaysTabMetadata>(
      metadata.pageMetadata!,
    );

    if (!pageMetadata) {
      throw new Error('Page metadata is required');
    }

    this.holidaysTabService.publish({
      user,
      metadata: pageMetadata,
      notice: `✅ Holiday ${entity.name} ${entity.isDisabled ? 'turned off' : 'turned on'}.`,
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error changing holiday status: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      await this.holidaysTabService.getModalView(
        HolidaysTabModalName.ToggleHolidayStatus,
        {
          holidayId: meta.id,
          user,
          errorMessage,
          pageMetadata: meta.pageMetadata!,
        },
      ),
    );
  }
}
