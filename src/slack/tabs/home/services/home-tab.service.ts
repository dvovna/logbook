import { Injectable } from '@nestjs/common';
import { HomeTabView } from 'src/slack/tabs/home/views/home-tab.view';
import { UserVacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { VacationRequestModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';
import ConfirmationModalView from 'src/slack/common/views/components/confirmation-modal.view';

export enum HomeTabModalName {
  CreateVacationRequest = 'CreateVacationRequest',
  CancelVacationRequest = 'CancelVacationRequest',
}

interface IRequestModalParams extends IOpenModalBaseParams {
  vacationRequestId: string;
}

type HomeTabModalViewResolversMapType = {
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
    private readonly userVacationsUsageService: UserVacationsUsageService,
    private readonly vacationsService: VacationRequestsService,
    private readonly vacationRequestModalView: VacationRequestModalView,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Home, {
      [HomeTabModalName.CreateVacationRequest]: (params) =>
        this.getCreateVacationRequestModal(params),
      [HomeTabModalName.CancelVacationRequest]: (params) =>
        this.getCancelVacationRequestModal(params),
    });
  }

  public async getTabView({ user }: IPublishBaseParams) {
    const [userVacationsUsageInfo, requestedVacations] = await Promise.all([
      await this.userVacationsUsageService.getCurrentVacationPeriodUsage(user),
      await this.vacationsService.findMany({
        userId: user.id,
        startDate: user.contract_start_date || undefined,
        status: VacationStatus.Pending,
      }),
    ]);

    return this.homeTabViewService.getView({
      userId: user.slack_id,
      userRole: user.role,
      vacationUsageInfo: userVacationsUsageInfo,
      requestedVacations,
    });
  }

  private getCreateVacationRequestModal(params: IOpenModalBaseParams) {
    return this.vacationRequestModalView.getView({
      errorMessage: params.errorMessage,
      callbackId: ViewCallbackId.UserVacationRequest,
    });
  }

  private getCancelVacationRequestModal(params: IRequestModalParams) {
    const { vacationRequestId, errorMessage } = params;

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.CancelVacationRequestFormSubmit,
        title: `Cancel Vacation`,
        message: `Are you sure you want to cancel this vacation request?`,
        errorMessage,
      },
      {
        id: vacationRequestId,
      },
    );
  }
}
