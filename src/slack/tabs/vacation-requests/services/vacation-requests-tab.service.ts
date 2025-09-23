import { Injectable } from '@nestjs/common';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types';
import {
  IVacationRequestsTabMetadata,
  VacationRequestsTabView,
} from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { ConfigService } from '@nestjs/config';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';
import TeamsService from 'src/teams/services/teams.service';
import { VacationRequestFormModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';
import {
  IViewVacationRequestModalViewParams,
  VacationDetailsModalService,
} from 'src/slack/tabs/vacation-requests/services/vacation-details-modal.service';

export enum VacationRequestsTabModalName {
  ViewRequest = 'ViewRequest',
  CreateRequest = 'CreateRequest',
  UpdateRequest = 'UpdateRequest',
  DeleteRequest = 'DeleteRequest',
}

export type IPublishVacationRequestsTabViewParams =
  IPublishBaseParams<IVacationRequestsTabMetadata>;

interface IVacationRequestModalViewParams extends IOpenModalBaseParams<string> {
  requestId?: string;
}

interface IDeleteVacationRequestModalViewParams
  extends IOpenModalBaseParams<string> {
  requestId: string;
}

type VacationRequestsTabModalViewResolversMapType = {
  [VacationRequestsTabModalName.ViewRequest]: (
    params: IViewVacationRequestModalViewParams,
  ) => Promise<View>;
  [VacationRequestsTabModalName.CreateRequest]: (
    params: IVacationRequestModalViewParams,
  ) => View;
  [VacationRequestsTabModalName.UpdateRequest]: (
    params: IVacationRequestModalViewParams,
  ) => Promise<View>;
  [VacationRequestsTabModalName.DeleteRequest]: (
    params: IDeleteVacationRequestModalViewParams,
  ) => View;
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
    private readonly vacationRequestFormModalView: VacationRequestFormModalView,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly config: ConfigService,
  ) {
    super(TabId.VacationRequests, {
      [VacationRequestsTabModalName.ViewRequest]: (params) =>
        this.getViewRequestModalView(params),
      [VacationRequestsTabModalName.CreateRequest]: (params) =>
        this.getCreateRequestModalView(params),
      [VacationRequestsTabModalName.UpdateRequest]: (params) =>
        this.getEditRequestModalView(params),
      [VacationRequestsTabModalName.DeleteRequest]: (params) =>
        this.getDeleteRequestModalView(params),
    });
  }

  protected async getTabView(params: IPublishVacationRequestsTabViewParams) {
    const [requests, teams] = await Promise.all([
      this.getVacationRequests(params),
      this.teamsService.findMany({
        slackTeamId: params.user.slack_team_id,
      }),
    ]);

    const minYear = this.config.getOrThrow<number>(EnvironmentVariable.MinYear);
    const maxYear = this.config.getOrThrow<number>(EnvironmentVariable.MaxYear);

    return this.vacationRequestsTabViewService.getView(
      {
        userId: params.user.slack_id,
        userRole: params.user.role,
        requests,
        teams,
        years: Array.from(
          { length: maxYear - minYear + 1 },
          (_, index) => index + minYear,
        ),
      },
      params.metadata,
    );
  }

  private async getVacationRequests({
    user,
    metadata = {},
  }: IPublishVacationRequestsTabViewParams) {
    return this.vacationRequestsService.search({
      page: metadata.page,
      filters: {
        slackTeamId: user.slack_team_id,
        ...(metadata?.filters?.teamId
          ? { teamId: metadata?.filters.teamId }
          : {}),
        ...(metadata?.filters?.user
          ? { userId: metadata?.filters.user.value }
          : {}),
        ...(metadata?.filters?.type ? { type: metadata?.filters.type } : {}),
        ...(metadata?.filters?.year ? { year: metadata?.filters.year } : {}),
        ...(metadata?.filters?.status
          ? { status: metadata?.filters?.status }
          : {}),
      },
    });
  }

  private async getViewRequestModalView(
    params: IViewVacationRequestModalViewParams,
  ): Promise<View> {
    return this.vacationDetailsModalService.getModal(params);
  }

  private getCreateRequestModalView({
    user,
    errorMessage,
    pageMetadata,
  }: IVacationRequestModalViewParams): View {
    return this.vacationRequestFormModalView.getView(
      {
        errorMessage,
        userRole: user.role,
        callbackId: ViewCallbackId.AdminVacationRequest,
      },
      { pageMetadata },
    );
  }

  private async getEditRequestModalView({
    user,
    errorMessage,
    pageMetadata,
    requestId,
  }: IVacationRequestModalViewParams) {
    const request = await this.vacationRequestsService.findOneWithValidation({
      id: requestId,
      slackTeamId: user.slack_team_id,
    });

    return this.vacationRequestFormModalView.getView(
      {
        errorMessage,
        initialData: {
          id: request.id,
          type: request.type,
          status: request.status,
          comment: request.user_comment || '',
          start_date: request.start_date,
          end_date: request.end_date,
          user: request.user && {
            id: request.user.id,
            name: request.user.name,
          },
        },
        userRole: user.role,
        callbackId: ViewCallbackId.AdminVacationRequest,
      },
      {
        pageMetadata,
        id: request.id,
      },
    );
  }

  private getDeleteRequestModalView({
    errorMessage,
    pageMetadata,
    requestId,
  }: IDeleteVacationRequestModalViewParams): View {
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
