import { Injectable } from '@nestjs/common';
import { HomeTabView } from '@modules/slack/tabs/home/views/home-tab.view';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { VacationDetailsModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';
import {
  VacationRequestModalService,
} from '@modules/slack/tabs/vacation-requests/services/vacation-request-modal.service';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';

export enum HomeTabModalName {
  ViewVacationRequest = 'ViewVacationRequest',
  CreateVacationRequest = 'CreateVacationRequest',
  CancelVacationRequest = 'CancelVacationRequest',
  CreateTimeEntry = 'CreateTimeEntry',
}

interface IRequestModalParams extends IOpenModalBaseParams {
  requestId: string;
}

type ICreateTimeEntryModalParams = IOpenModalBaseParams;

type HomeTabModalViewResolversMapType = {
  [HomeTabModalName.ViewVacationRequest]: (
    params: IRequestModalParams,
  ) => Promise<View>;
  [HomeTabModalName.CreateVacationRequest]: (
    params: IOpenModalBaseParams,
  ) => Promise<View>;
  [HomeTabModalName.CancelVacationRequest]: (
    params: IRequestModalParams,
  ) => View;
  [HomeTabModalName.CreateTimeEntry]: (
    params: ICreateTimeEntryModalParams,
  ) => Promise<View>;
};

@Injectable()
export class HomeTabService extends BaseTabService<HomeTabModalViewResolversMapType> {
  public constructor(
    private readonly homeTabViewService: HomeTabView,
    private readonly userVacationsUsageService: VacationsUsageService,
    private readonly vacationsService: VacationRequestsService,
    private readonly vacationRequestModalService: VacationRequestModalService,
    private readonly timeEntryModalService: TimeEntryModalService,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly confirmationModalView: ConfirmationModalView,
    private readonly timeEntriesSummaryService: TimeEntriesSummaryService,
  ) {
    super(TabId.Home, {
      [HomeTabModalName.ViewVacationRequest]: (params) =>
        this.getViewVacationRequestModal(params),
      [HomeTabModalName.CreateVacationRequest]: (params) =>
        this.getCreateVacationRequestModal(params),
      [HomeTabModalName.CancelVacationRequest]: (params) =>
        this.getCancelVacationRequestModal(params),
      [HomeTabModalName.CreateTimeEntry]: (params) =>
        this.getCreateTimeEntryModal(params),
    });
  }

  public async getTabView({ user }: IPublishBaseParams) {
    const [vacationUsageInfo, requestedVacations, timeSummary] =
      await Promise.all([
        this.userVacationsUsageService.getCurrentVacationPeriodUsage(user),
        this.vacationsService.findMany({
          userId: user.id,
          startDate: user.contract_start_date || undefined,
          statuses: [VacationRequestStatus.Pending],
        }),
        this.timeEntriesSummaryService.getUserSummary(user),
      ]);

    return this.homeTabViewService.getView({
      userId: user.slack_id,
      userRole: user.role,
      vacationUsageInfo,
      requestedVacations,
      timeSummary,
    });
  }

  private getViewVacationRequestModal(params: IRequestModalParams) {
    return this.vacationDetailsModalService.getModal(params);
  }

  private getCreateVacationRequestModal(params: IOpenModalBaseParams) {
    return this.vacationRequestModalService.getModal({
      errorMessage: params.errorMessage,
      user: params.user,
      callbackId: ViewCallbackId.UserVacationRequest,
    });
  }

  private getCancelVacationRequestModal(params: IRequestModalParams) {
    const { requestId, errorMessage } = params;

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.CancelVacationRequestFormSubmit,
        title: `Cancel Vacation`,
        message: `Are you sure you want to cancel this vacation request?`,
        errorMessage,
      },
      {
        id: requestId,
      },
    );
  }

  private getCreateTimeEntryModal(params: ICreateTimeEntryModalParams) {
    const { errorMessage, user } = params;

    return this.timeEntryModalService.getModal(
      {
        user,
        errorMessage,
      },
    );
  }
}
