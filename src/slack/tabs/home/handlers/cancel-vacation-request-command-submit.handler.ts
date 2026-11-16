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
import { TimeOffChangesService } from 'src/time-off-logging/services/time-off-changes.service';
import { IVacationRequestChange } from 'src/time-off-logging/types/time-off-change.types';
import { withBilledDays } from 'src/slack/tabs/vacation-requests/views/billed-days-notice';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.CancelVacationRequestCommandSubmit,
  type: 'view_submission',
  allowedRoles: ALL_ROLES,
})
export class CancelVacationRequestCommandSubmitHandler extends BaseModalFormSubmitHandler<
  object,
  ICancelVacationRequestFormData,
  IVacationRequestChange
> {
  public constructor(
    formParser: CancelVacationRequestModalViewValuesParser,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly timeOffChangesService: TimeOffChangesService,
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
    return this.timeOffChangesService.cancel(
      { id: data.request.value, slackTeamId: user.slack_team_id },
      user,
    );
  }

  // `/vacations cancel` has no tab to go back to: the form closes, and Home
  // shows the notice, as after Cancel there.
  protected successResponse(
    { billedDates }: IVacationRequestChange,
    user: IUserViewModel,
  ): ViewResponseAction {
    this.homeTabService.publish({
      user,
      notice: withBilledDays('✅ Vacation request canceled.', billedDates),
    });

    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ICancelVacationRequestFormData,
    _meta: object,
    user: IUserViewModel,
  ): Promise<ViewResponseAction> {
    const requests = await this.vacationRequestsService.findCancelable(user);

    // With nothing left to cancel (approved or canceled meanwhile) the form
    // has no choices, which Slack refuses: only what went wrong.
    return SlackViewResponseFactory.update(
      requests.length
        ? this.modalView.getView({ requests, errorMessage })
        : this.modalView.getErrorView('Cancel Vacation', errorMessage),
    );
  }
}
