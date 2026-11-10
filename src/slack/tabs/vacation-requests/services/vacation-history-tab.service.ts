import { Injectable } from '@nestjs/common';
import BaseTabService, {
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { ConfigService } from '@nestjs/config';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import {
  IVacationHistoryTabMetadata,
  VacationHistoryTabView,
} from '@modules/slack/tabs/vacation-requests/views/vacation-history-tab.view';
import {
  IViewVacationRequestModalViewParams,
  VacationDetailsModalService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';
import { View } from '@slack/types';
import TeamsService from '@modules/teams/services/teams.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { VacationRequestModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-request-modal.service';
import { IOpenModalBaseParams } from '@modules/slack/common/types/tab-params.types';

export type IPublishVacationsHistoryTabViewParams =
  IPublishBaseParams<IVacationHistoryTabMetadata>;

const VACATION_HISTORY_PAGE_SIZE = 10;
const UPCOMING_SHOWN = 5;

export enum HistoryTabModalName {
  ViewRequestDetails = 'ViewRequestDetails',
  RequestTimeOff = 'RequestTimeOff',
}

type HistoryTabModalViewResolversMapType = {
  [HistoryTabModalName.ViewRequestDetails]: (
    params: IViewVacationRequestModalViewParams,
  ) => Promise<View>;
  [HistoryTabModalName.RequestTimeOff]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
};

@Injectable()
export class VacationHistoryTabService extends BaseTabService<
  HistoryTabModalViewResolversMapType,
  IPublishVacationsHistoryTabViewParams
> {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationsHistoryTabView: VacationHistoryTabView,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly config: ConfigService,
    private readonly teamsService: TeamsService,
    private readonly vacationRequestModalService: VacationRequestModalService,
  ) {
    super(TabId.TimeOff, {
      [HistoryTabModalName.ViewRequestDetails]: (params) =>
        this.getViewRequestDetailsModal(params),
      [HistoryTabModalName.RequestTimeOff]: ({
        user,
        errorMessage,
        pageMetadata,
      }) =>
        this.vacationRequestModalService.getModal({
          user,
          errorMessage,
          callbackId: ViewCallbackId.UserVacationRequest,
          pageMetadata,
        }),
    });
  }

  protected async getTabView(params: IPublishVacationsHistoryTabViewParams) {
    const [requests, upcoming] = await Promise.all([
      this.getVacationRequests(params),
      this.getUpcoming(params.user),
    ]);

    const minYear = this.config.getOrThrow<number>(EnvironmentVariable.MinYear);
    const maxYear = this.config.getOrThrow<number>(EnvironmentVariable.MaxYear);

    return this.vacationsHistoryTabView.getView(
      {
        userId: params.user.slack_id,
        userRole: params.user.role,
        requests,
        upcoming,
        years: Array.from(
          { length: maxYear - minYear + 1 },
          (_, index) => index + minYear,
        ),
      },
      params.metadata,
    );
  }

  // Admin and HR see everyone's time off, a manager their teams' only.
  private async getUpcoming(user: IUserViewModel) {
    if (!MANAGER_ROLES.includes(user.role)) {
      return null;
    }

    const teamIds = await this.teamsService.findManagedTeamIds(user);
    const { items } = await this.vacationRequestsService.search({
      filters: {
        slackTeamId: user.slack_team_id,
        ...(teamIds ? { teamIds } : {}),
        statuses: [VacationRequestStatus.Approved],
        startDate: new Date().toUTCString(),
      },
      pageSize: UPCOMING_SHOWN,
      orderBy: ['start_date:asc', 'created_at:desc'],
    });

    return items;
  }

  private async getViewRequestDetailsModal(
    params: IViewVacationRequestModalViewParams,
  ): Promise<View> {
    return this.vacationDetailsModalService.getModal(params);
  }

  private async getVacationRequests({
    user,
    metadata = {},
  }: IPublishVacationsHistoryTabViewParams) {
    const { type, year, status } = metadata?.filters ?? {};

    return this.vacationRequestsService.search({
      page: metadata.page,
      pageSize: VACATION_HISTORY_PAGE_SIZE,
      orderBy: ['start_date:desc', 'created_at:desc'],
      filters: {
        slackTeamId: user.slack_team_id,
        userId: user.id,
        // Every request, rejected and canceled ones too, so a user can see
        // what became of each.
        ...(status && { statuses: [status] }),
        ...(year && { year }),
        ...(type && { type }),
      },
    });
  }
}
