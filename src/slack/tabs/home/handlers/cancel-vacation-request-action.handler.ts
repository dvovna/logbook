import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/components/confirmation-modal.view';
import { Injectable, Logger } from '@nestjs/common';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import {
  HomeTabModalName,
  HomeTabService,
} from 'src/slack/tabs/home/services/home-tab.service';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CancelVacationRequestFormSubmit,
  type: 'view_submission',
})
export class CancelVacationRequestActionHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  private readonly logger = new Logger(CancelVacationRequestActionHandler.name);

  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly homeTabService: HomeTabService,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super();
  }

  protected async onSubmit(
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    const { id: requestId } = meta;

    await this.vacationRequestsService.update(
      {
        id: requestId,
        slackTeamId: user.slack_team_id,
      },
      {
        status: VacationRequestStatus.Canceled,
      },
      user,
    );
  }

  protected successResponse(_result, user: IUserViewModel): ViewResponseAction {
    this.homeTabService.publish({
      user,
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        `✅ Vacation Request has been canceled.`,
      ),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: object,
    meta: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    this.logger.warn(`Error canceling vacation request: ${errorMessage}`);

    return SlackViewResponseFactory.update(
      await this.homeTabService.getModalView(
        HomeTabModalName.CancelVacationRequest,
        {
          requestId: meta.id,
          user,
          errorMessage,
        },
      ),
    );
  }
}
