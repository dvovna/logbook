import { ALL_ROLES } from '@common/constants/role-groups';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import ConfirmationModalView, {
  IConfirmationModalViewMetadata,
} from '@modules/slack/common/views/components/confirmation-modal.view';
import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import {
  HomeTabModalName,
  HomeTabService,
} from '@modules/slack/tabs/home/services/home-tab.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CancelVacationRequestFormSubmit,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class CancelVacationRequestActionHandler extends BaseModalFormSubmitHandler<IConfirmationModalViewMetadata> {
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
    await this.vacationRequestsService.cancel(meta.id, user);
  }

  protected successResponse(_result, user: IUserViewModel): ViewResponseAction {
    this.homeTabService.publish({
      user,
      notice: '✅ Vacation request canceled.',
    });

    return SlackViewResponseFactory.success();
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
