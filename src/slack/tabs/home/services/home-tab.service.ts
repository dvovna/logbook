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
import { VacationRequestFormModalView } from '@modules/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { VacationDetailsModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';

export enum HomeTabModalName {
  ViewVacationRequest = 'ViewVacationRequest',
  CreateVacationRequest = 'CreateVacationRequest',
  CancelVacationRequest = 'CancelVacationRequest',
}

interface IRequestModalParams extends IOpenModalBaseParams {
  requestId: string;
}

type HomeTabModalViewResolversMapType = {
  [HomeTabModalName.ViewVacationRequest]: (
    params: IRequestModalParams,
  ) => Promise<View>;
  [HomeTabModalName.CreateVacationRequest]: (
    params: IOpenModalBaseParams,
  ) => View;
  [HomeTabModalName.CancelVacationRequest]: (
    params: IRequestModalParams,
  ) => View;
};

@Injectable()
export class HomeTabService extends BaseTabService<HomeTabModalViewResolversMapType> {
  public constructor(
    private readonly homeTabViewService: HomeTabView,
    private readonly userVacationsUsageService: VacationsUsageService,
    private readonly vacationsService: VacationRequestsService,
    private readonly vacationRequestModalView: VacationRequestFormModalView,
    private readonly vacationDetailsModalService: VacationDetailsModalService,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Home, {
      [HomeTabModalName.ViewVacationRequest]: (params) =>
        this.getViewVacationRequestModal(params),
      [HomeTabModalName.CreateVacationRequest]: (params) =>
        this.getCreateVacationRequestModal(params),
      [HomeTabModalName.CancelVacationRequest]: (params) =>
        this.getCancelVacationRequestModal(params),
    });
  }

  public async getTabView({ user }: IPublishBaseParams) {
    const [vacationUsageInfo, requestedVacations] = await Promise.all([
      await this.userVacationsUsageService.getCurrentVacationPeriodUsage(user),
      await this.vacationsService.findMany({
        userId: user.id,
        startDate: user.contract_start_date || undefined,
        status: VacationRequestStatus.Pending,
      }),
    ]);

    return this.homeTabViewService.getView({
      userId: user.slack_id,
      userRole: user.role,
      vacationUsageInfo,
      requestedVacations,
    });
  }

  private getViewVacationRequestModal(params: IRequestModalParams) {
    return this.vacationDetailsModalService.getModal(params);
  }

  private getCreateVacationRequestModal(params: IOpenModalBaseParams) {
    return this.vacationRequestModalView.getView({
      errorMessage: params.errorMessage,
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
}
