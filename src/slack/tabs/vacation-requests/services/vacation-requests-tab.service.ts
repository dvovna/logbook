import { Injectable } from '@nestjs/common';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import {
  IVacationRequestsTabMetadata,
  VacationRequestsTabView,
} from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { ConfigService } from '@nestjs/config';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import TeamsService from '@modules/teams/services/teams.service';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import {
  IViewVacationRequestModalViewParams,
  VacationDetailsModalService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { VacationRequestModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-request-modal.service';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';

export enum VacationRequestsTabModalName {
  ViewRequest = 'ViewRequest',
  CreateRequest = 'CreateRequest',
  UpdateRequest = 'UpdateRequest',
  DeleteRequest = 'DeleteRequest',
  ApproveOnBehalf = 'ApproveOnBehalf',
}

export type IPublishVacationRequestsTabViewParams =
  IPublishBaseParams<IVacationRequestsTabMetadata>;

interface IVacationRequestModalViewParams extends IOpenModalBaseParams<string> {
  requestId?: string;
}

interface IVacationRequestConfirmationModalViewParams extends IOpenModalBaseParams<string> {
  requestId: string;
}

type VacationRequestsTabModalViewResolversMapType = {
  [VacationRequestsTabModalName.ViewRequest]: (
    params: IViewVacationRequestModalViewParams,
  ) => Promise<View>;
  [VacationRequestsTabModalName.CreateRequest]: (
    params: IVacationRequestModalViewParams,
  ) => Promise<View>;
  [VacationRequestsTabModalName.UpdateRequest]: (
    params: IVacationRequestModalViewParams,
  ) => Promise<View>;
  [VacationRequestsTabModalName.DeleteRequest]: (
    params: IVacationRequestConfirmationModalViewParams,
  ) => View;
  [VacationRequestsTabModalName.ApproveOnBehalf]: (
    params: IVacationRequestConfirmationModalViewParams,
  ) => Promise<View>;
};

@Injectable()
export class VacationRequestsTabService extends BaseTabService<
  VacationRequestsTabModalViewResolversMapType,
  IPublishVacationRequestsTabViewParams
> {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly vacationRequestsTabViewService: VacationRequestsTabView,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly vacationRequestModalService: VacationRequestModalService,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly config: ConfigService,
  ) {
    super(TabId.VacationRequests, {
      [VacationRequestsTabModalName.ViewRequest]: (params) =>
        this.getViewRequestModalView(params),
      [VacationRequestsTabModalName.CreateRequest]: (params) =>
        this.getRequestModalView(params),
      [VacationRequestsTabModalName.UpdateRequest]: (params) =>
        this.getRequestModalView(params),
      [VacationRequestsTabModalName.DeleteRequest]: (params) =>
        this.getDeleteRequestModalView(params),
      [VacationRequestsTabModalName.ApproveOnBehalf]: (params) =>
        this.getApproveOnBehalfModalView(params),
    });
  }

  protected async getTabView(params: IPublishVacationRequestsTabViewParams) {
    const userTeams = await this.getUserTeams(params.user);
    const requests = await this.getVacationRequests(params, userTeams);

    const minYear = this.config.getOrThrow<number>(EnvironmentVariable.MinYear);
    const maxYear = this.config.getOrThrow<number>(EnvironmentVariable.MaxYear);

    return this.vacationRequestsTabViewService.getView(
      {
        userId: params.user.slack_id,
        userRole: params.user.role,
        requests,
        teams: userTeams,
        years: Array.from(
          { length: maxYear - minYear + 1 },
          (_, index) => index + minYear,
        ),
      },
      params.metadata,
    );
  }

  private getUserTeams(user: IUserViewModel) {
    return this.teamsService.findMany({
      slackTeamId: user.slack_team_id,
      ...(user.role === UserRole.Manager
        ? { managerApprovers: [user.slack_id] }
        : {}),
    });
  }

  private async getVacationRequests(
    { user, metadata = {} }: IPublishVacationRequestsTabViewParams,
    userTeams: ITeamViewModel[],
  ) {
    const userTeamIdsRange =
      user.role === UserRole.Manager ? userTeams.map((team) => team.id) : null;

    return this.vacationRequestsService.search({
      page: metadata.page,
      filters: {
        slackTeamId: user.slack_team_id,
        ...(metadata?.filters?.teamId
          ? { teamId: metadata?.filters.teamId }
          : {}),
        ...(metadata?.filters?.user
          ? { userId: metadata?.filters.user.id }
          : {}),
        ...(userTeamIdsRange && !metadata?.filters?.teamId
          ? { teamIds: userTeamIdsRange }
          : {}),
        ...(metadata?.filters?.type ? { type: metadata?.filters.type } : {}),
        ...(metadata?.filters?.year ? { year: metadata?.filters.year } : {}),
        ...(metadata?.filters?.status
          ? { statuses: [metadata?.filters?.status] }
          : {}),
      },
    });
  }

  private async getViewRequestModalView(
    params: IViewVacationRequestModalViewParams,
  ): Promise<View> {
    return this.vacationDetailsModalService.getModal(params);
  }

  private async getRequestModalView(params: IVacationRequestModalViewParams) {
    return this.vacationRequestModalService.getModal(params);
  }

  private async getApproveOnBehalfModalView({
    errorMessage,
    pageMetadata,
    requestId,
    user,
  }: IVacationRequestConfirmationModalViewParams): Promise<View> {
    const waitingSteps =
      await this.requestWorkflowService.findCurrentLevelSteps(
        requestId,
        user.slack_team_id,
      );
    const approvers = waitingSteps
      .map(({ slack_user_id }) => `<@${slack_user_id}>`)
      .join(', ');

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.ApproveVacationRequestOnBehalf,
        title: 'Approve for Approvers',
        message: approvers
          ? `The request is waiting for ${approvers}. Approve it for them? It then moves on to the next approvers, or gets approved if there are none.`
          : 'This request is not waiting for anyone to approve it. To change its status, use Edit Request.',
        errorMessage,
      },
      {
        id: requestId,
        pageMetadata,
      },
    );
  }

  private getDeleteRequestModalView({
    errorMessage,
    pageMetadata,
    requestId,
  }: IVacationRequestConfirmationModalViewParams): View {
    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.DeleteVacationRequest,
        title: 'Delete Vacation Request',
        message: `Are you sure you want to delete this Vacation Request?`,
        errorMessage,
      },
      {
        id: requestId,
        pageMetadata,
      },
    );
  }
}
