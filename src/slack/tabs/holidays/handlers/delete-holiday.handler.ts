import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/components/confirmation-modal.view';
import HolidaysService from 'src/holidays/services/holidays.service';
import {
  HolidaysTabModalName,
  HolidaysTabService,
} from 'src/slack/tabs/holidays/services/holidays-tab.service';
import { IHolidaysTabMetadata } from 'src/slack/tabs/holidays/views/holidays-tab.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { jsonParse } from 'src/common/utils/json-parse';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteHoliday,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class DeleteHolidayHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  private readonly logger = new Logger(DeleteHolidayHandler.name);

  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly holidaysService: HolidaysService,
    private readonly holidaysTabService: HolidaysTabService,
  ) {
    super();
  }

  protected async onSubmit(
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    await this.holidaysService.deleteMany({
      id: metadata.id,
      slackTeamId: user.slack_team_id,
    });
  }

  protected successResponse(
    _entity: void,
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
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        '✅ Holiday deleted successfully.',
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.error('Error while deleting the holiday: ', errorMessage);

    return SlackViewResponseFactory.update(
      await this.holidaysTabService.getModalView(
        HolidaysTabModalName.DeleteHoliday,
        {
          holidayId: metadata.id,
          user,
          errorMessage,
          pageMetadata: metadata.pageMetadata!,
        },
      ),
    );
  }
}
