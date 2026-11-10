import { Injectable } from '@nestjs/common';
import {
  IVacationRequestChange,
  VacationRequestsService,
} from '@modules/vacation-requests/services/vacation-requests.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import VacationRequestAdminViewValuesParser, {
  IVacationRequestAdminFormViewData,
} from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-admin-view-values.parser';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  IVacationRequestModalViewMetadata,
  VacationRequestFormModalView,
} from '@modules/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { IVacationRequestsTabMetadata } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { UsersService } from '@modules/users/services/users.service';
import UserRole from '@common/enums/user-role.enum';
import { withBilledDays } from '@modules/slack/tabs/vacation-requests/views/billed-days-notice';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.AdminVacationRequest,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class AdminVacationRequestHandler extends BaseModalFormSubmitHandler<
  IVacationRequestModalViewMetadata,
  IVacationRequestAdminFormViewData,
  IVacationRequestChange
> {
  // Overlaps and balance concern the period: shown under its end.
  protected readonly errorFields = { dates: 'end_date' as const };

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
    { billedDates }: IVacationRequestChange,
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
      // Who changed the vacation hears which days' logged time stayed.
      notice: withBilledDays(
        `✅ Vacation request ${metadata.id ? 'updated' : 'created'}.`,
        billedDates,
      ),
    });

    return SlackViewResponseFactory.success();
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

  // HR or an admin creates the request for the user chosen in the form, so
  // the request belongs to that user's team (and goes to its approvers).
  private async create(
    data: IVacationRequestAdminFormViewData,
    user: IUserViewModel,
  ): Promise<IVacationRequestChange> {
    const selectedUser = await this.usersService.findOneWithValidation({
      id: data.user.value,
      slackTeamId: user.slack_team_id,
    });

    const request = await this.vacationRequestsService.create(
      {
        teamId: selectedUser.team_id,
        userId: data.user.value,
        startDate: new Date(data.start_date),
        endDate: new Date(data.end_date),
        type: data.type_option.value,
        status: data.status.value || VacationRequestStatus.Pending,
        userComment: data.comment,
      },
      user,
    );

    return { request, billedDates: [] };
  }

  // The request goes to the chosen user's team, as on create; the service
  // reads the user beside the request.
  private update(
    id: string,
    data: IVacationRequestAdminFormViewData,
    user: IUserViewModel,
  ): Promise<IVacationRequestChange> {
    return this.vacationRequestsService.update(
      {
        id,
        slackTeamId: user.slack_team_id,
      },
      {
        inOwnersTeam: true,
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
