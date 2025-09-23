import { Injectable } from '@nestjs/common';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import VacationRequestAdminViewValuesParser, {
  IVacationRequestAdminFormViewData,
} from 'src/slack/tabs/vacation-requests/parsers/vacation-request-admin-view-values.parser';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  IVacationRequestModalViewMetadata,
  VacationRequestFormModalView,
} from 'src/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { IVacationRequestsTabMetadata } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { UsersService } from 'src/users/users.service';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.AdminVacationRequest,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class AdminVacationRequestHandler extends BaseModalFormSubmitHandler<
  IVacationRequestModalViewMetadata,
  IVacationRequestAdminFormViewData,
  IVacationRequestViewModel
> {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly vacationRequestModalView: VacationRequestFormModalView,
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
        status: data.status.value || VacationRequestStatus.Pending,
        userComment: data.comment,
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
        userComment: data.comment,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
      },
      user,
    );
  }

  protected errorResponse(
    errorMessage: string,
    data: IVacationRequestAdminFormViewData,
    metadata: IVacationRequestModalViewMetadata,
    user: IUserViewModel,
  ) {
    const initialData = metadata.id && {
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
    };

    return SlackViewResponseFactory.update(
      this.vacationRequestModalView.getView(
        {
          errorMessage,
          initialData: initialData || undefined,
          userRole: user.role,
          callbackId: ViewCallbackId.AdminVacationRequest,
        },
        {
          pageMetadata: metadata.pageMetadata,
        },
      ),
    );
  }
}
