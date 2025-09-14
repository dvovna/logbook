import { Injectable } from '@nestjs/common';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import VacationRequestUserViewValuesParser, {
  IVacationRequestUserFormViewData,
} from 'src/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  IVacationRequestModalViewMetadata,
  VacationRequestModalView,
} from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UserVacationRequest,
  type: 'view_submission',
})
export class UserVacationRequestHandler extends BaseModalFormSubmitHandler<
  IVacationRequestModalViewMetadata,
  IVacationRequestUserFormViewData,
  IVacationRequestViewModel
> {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly vacationRequestModalViewService: VacationRequestModalView,
    private readonly vacationRequestModalView: VacationRequestModalView,
    vacationRequestUserViewValuesParser: VacationRequestUserViewValuesParser,
  ) {
    super(vacationRequestUserViewValuesParser);
  }

  protected successResponse(
    _request: IVacationRequestViewModel,
    user: IUserViewModel,
    metadata: IVacationRequestModalViewMetadata,
  ) {
    this.tabNavigationService.navigate(TabId.Home, {
      user,
    });

    return SlackViewResponseFactory.update(
      this.vacationRequestModalViewService.getSuccessView(
        `✅ Vacation Request was ${metadata.id ? 'updated' : 'created'} successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: IVacationRequestUserFormViewData,
    metadata: IVacationRequestModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  private create(data: IVacationRequestUserFormViewData, user: IUserViewModel) {
    return this.vacationRequestsService.create(
      {
        userId: user.id,
        teamId: user.team_id,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
        type: data.type_option.value,
        status: VacationStatus.Pending,
        comment: data.comment,
      },
      user,
    );
  }

  private update(
    id: string,
    data: IVacationRequestUserFormViewData,
    user: IUserViewModel,
  ) {
    return this.vacationRequestsService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        teamId: user.team_id,
        type: data.type_option.value,
        comment: data.comment,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
      },
      user,
    );
  }

  protected errorResponse(errorMessage: string) {
    return SlackViewResponseFactory.update(
      this.vacationRequestModalView.getView({
        errorMessage: errorMessage,
        callbackId: ViewCallbackId.UserVacationRequest,
      }),
    );
  }
}
