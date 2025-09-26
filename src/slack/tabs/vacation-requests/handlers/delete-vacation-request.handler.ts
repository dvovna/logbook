import { Injectable, Logger } from '@nestjs/common';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from 'src/slack/common/views/components/confirmation-modal.view';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import {
  VacationRequestsTabModalName,
  VacationRequestsTabService,
} from 'src/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { jsonParse } from 'src/common/utils/json-parse';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteVacationRequest,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class DeleteVacationRequestHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
  private readonly logger = new Logger(DeleteVacationRequestHandler.name);

  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationRequestsTabService: VacationRequestsTabService,
  ) {
    super();
  }

  protected successResponse(
    _result: void,
    user: IUserViewModel,
    metadata: IConfirmationModalViewMetadata,
  ) {
    const pageMetadata = jsonParse<IVacationRequestsTabMetadata>(
      metadata.pageMetadata || '{}',
    );

    this.vacationRequestsTabService.publish({
      user,
      metadata: {
        ...pageMetadata,
        page: 1,
      },
    });

    return SlackViewResponseFactory.update(
      this.confirmationModalView.getSuccessView(
        '✅ Vacation request deleted successfully.',
      ),
    );
  }

  protected async onSubmit(
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    await this.vacationRequestsService.delete(
      {
        id: metadata.id,
        slackTeamId: user.slack_team_id,
      },
      user,
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    this.logger.error(
      'Error while deleting the vacation request: ',
      errorMessage,
    );

    return SlackViewResponseFactory.update(
      await this.vacationRequestsTabService.getModalView(
        VacationRequestsTabModalName.DeleteRequest,
        {
          requestId: metadata.id,
          user,
          errorMessage:
            'An error occurred while deleting. Please try again later.',
          pageMetadata: metadata.pageMetadata!,
        },
      ),
    );
  }
}
