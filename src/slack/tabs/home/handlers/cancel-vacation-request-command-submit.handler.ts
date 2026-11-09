import { ALL_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { HomeTabService } from 'src/slack/tabs/home/services/home-tab.service';
import CancelVacationRequestModalViewValuesParser, {
  ICancelVacationRequestFormData,
} from 'src/slack/tabs/home/parsers/cancel-vacation-request-modal-view-values.parser';
import { CancelVacationRequestSelectModalView } from 'src/slack/tabs/home/views/cancel-vacation-request-select-modal.view';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CancelVacationRequestCommandSubmit,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class CancelVacationRequestCommandSubmitHandler extends BaseModalFormSubmitHandler<
  object,
  ICancelVacationRequestFormData
> {
  public constructor(
    formParser: CancelVacationRequestModalViewValuesParser,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly homeTabService: HomeTabService,
    private readonly modalView: CancelVacationRequestSelectModalView,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    data: ICancelVacationRequestFormData,
    _meta: object,
    user: IUserViewModel,
  ) {
    await this.vacationRequestsService.cancel(data.request.value, user);
  }

  protected successResponse(_result, user: IUserViewModel): ViewResponseAction {
    this.homeTabService.publish({ user });

    return SlackViewResponseFactory.update(
      this.modalView.getSuccessView('✅ Vacation Request has been canceled.'),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ICancelVacationRequestFormData,
    _meta: object,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const requests = await this.vacationRequestsService.findMany({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      statuses: [VacationRequestStatus.Pending],
    });

    return SlackViewResponseFactory.update(
      this.modalView.getView({ requests, errorMessage }),
    );
  }
}
