import { Injectable } from '@nestjs/common';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import VacationRequestAdminViewValuesParser, {
  IVacationRequestAdminFormViewData,
} from 'src/slack/tabs/vacation-requests/parsers/vacation-request-admin-view-values.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import {
  IVacationRequestModalViewMetadata,
  VacationRequestModalView,
} from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
import { IVacationRequestsTabMetadata } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { ValidationError } from 'src/common/errors/validation.error';
import { UsersService } from 'src/users/users.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.AdminVacationRequest,
  type: 'view_submission',
})
export class AdminVacationRequestHandler extends BaseModalFormSubmitHandler<
  IVacationRequestModalViewMetadata,
  IVacationRequestAdminFormViewData,
  IVacationRequestViewModel
> {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly vacationRequestModalView: VacationRequestModalView,
    private readonly usersService: UsersService,
    vacationRequestAdminViewValuesParser: VacationRequestAdminViewValuesParser,
  ) {
    super(vacationRequestAdminViewValuesParser);
  }

  protected successResponse(
    _request: IVacationRequestViewModel,
    user: IUserViewModel,
    metadata: IVacationRequestModalViewMetadata,
  ) {
    const pageMetadata = metadata.pageMetadata
      ? (JSON.parse(metadata.pageMetadata) as IVacationRequestsTabMetadata)
      : {};

    this.tabNavigationService.navigate(TabId.VacationRequests, {
      user,
      page: 1,
      metadata: pageMetadata,
    });

    return SlackViewResponseFactory.update(
      this.vacationRequestModalView.getSuccessView(
        `✅ Vacation Request was ${metadata.id ? 'updated' : 'created'} successfully!`,
      ),
    );
  }

  protected onSubmit(
    data: IVacationRequestAdminFormViewData,
    metadata: IVacationRequestModalViewMetadata,
    user: IUserViewModel,
  ) {
    return metadata.id
      ? this.update(metadata.id, data, user)
      : this.create(data, user);
  }

  private create(
    data: IVacationRequestAdminFormViewData,
    user: IUserViewModel,
  ): Promise<IVacationRequestViewModel> {
    return this.vacationRequestsService.create(
      {
        teamId: user.team_id,
        userId: data.user.value,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
        type: data.type_option.value,
        status: data.status.value || VacationStatus.Pending,
        comment: data.comment,
      },
      user,
    );
  }

  private async update(
    id: string,
    data: IVacationRequestAdminFormViewData,
    user: IUserViewModel,
  ): Promise<IVacationRequestViewModel> {
    const selectedUser = await this.usersService.findOneWithValidation({
      id: data.user.value,
      slackTeamId: user.slack_team_id,
    });

    return this.vacationRequestsService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        teamId: selectedUser?.team_id,
        userId: data.user.value,
        type: data.type_option.value,
        status: data.status.value,
        comment: data.comment,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
      },
      user,
    );
  }

  protected errorResponse(
    error: Error,
    data: IVacationRequestAdminFormViewData,
    metadata: IVacationRequestModalViewMetadata,
    user: IUserViewModel,
  ) {
    const errorMessage =
      error instanceof MaxItemsCountReachedError ||
      error instanceof ValidationError
        ? error.message
        : 'An error occurred while creating or updating the request. Please try again later.';

    return SlackViewResponseFactory.update(
      this.vacationRequestModalView.getView({
        errorMessage,
        pageMetadata: metadata.pageMetadata,
        initialData: metadata.id
          ? {
            id: metadata.id,
            type: data.type_option.value,
            status: data.status.value,
            comment: data.comment || '',
            start_date: data.start_date,
            end_date: data.end_date,
            user: data.user
              ? {
                id: data.user.value,
                name: data.user.text,
              }
              : null,
          }
          : undefined,
        userRole: user.role,
        callbackId: ViewCallbackId.AdminVacationRequest,
      }),
    );
  }
}
