import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IVacationRequestsTabMetadata } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import {
  IVacationRequestChange,
  VacationRequestsService,
} from '@modules/vacation-requests/services/vacation-requests.service';
import {
  VacationRequestsTabModalName,
  VacationRequestsTabService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import { jsonParse } from '@common/utils/json-parse';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import UserRole from '@common/enums/user-role.enum';
import { withBilledDays } from '@modules/slack/tabs/vacation-requests/views/billed-days-notice';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.DeleteVacationRequest,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin],
})
export class DeleteVacationRequestHandler extends BaseModalFormSubmitHandler<
  IConfirmationModalViewMetadata,
  object,
  IVacationRequestChange
> {
  public constructor(
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationRequestsTabService: VacationRequestsTabService,
  ) {
    super();
  }

  protected successResponse(
    { billedDates }: IVacationRequestChange,
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
      // Who deleted it hears which days' logged time stayed.
      notice: withBilledDays('✅ Vacation request deleted.', billedDates),
    });

    return SlackViewResponseFactory.success();
  }

  protected onSubmit(
    _data: never,
    metadata: IConfirmationModalViewMetadata,
    user: IUserViewModel,
  ) {
    return this.vacationRequestsService.delete(
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
