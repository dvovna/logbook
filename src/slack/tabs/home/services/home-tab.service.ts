import { Injectable } from '@nestjs/common';
import { HomeTabView } from 'src/slack/tabs/home/views/home-tab.view';
import { UserVacationsUsageService } from 'src/vacation-requests/services/user-vacation-usage.service';
import VacationStatus from 'src/common/enums/vacation-status.enum';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import UserRole from 'src/common/enums/user-role.enum';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from 'src/slack/common/services/base-tab.service';
import { View } from '@slack/types/dist/views';
import { VacationRequestModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { TabId } from 'src/slack/common/services/tab-navigation.service';

export enum HomeTabModalName {
  CreateVacationRequest = 'CreateVacationRequest',
}

type HomeTabModalViewResolversMapType = {
  [HomeTabModalName.CreateVacationRequest]: (
    params: IOpenModalBaseParams,
  ) => View;
};

@Injectable()
export class HomeTabService extends BaseTabService<HomeTabModalViewResolversMapType> {
  public constructor(
    private readonly homeTabViewService: HomeTabView,
    private readonly userVacationsUsageService: UserVacationsUsageService,
    private readonly vacationsService: VacationRequestsService,
    private readonly vacationRequestModalView: VacationRequestModalView,
  ) {
    super(TabId.Home, {
      [HomeTabModalName.CreateVacationRequest]: (params) =>
        this.createVacationRequestModal(params),
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
      vacationUsageInfo: userVacationsUsageInfo,
      requestedVacations,
      isUserAdmin: user.role === UserRole.Admin,
    });
  }

  private createVacationRequestModal(params: IOpenModalBaseParams) {
    return this.vacationRequestModalView.getView({
      errorMessage: params.errorMessage,
      callbackId: ViewCallbackId.UserVacationRequest,
    });
  }
}
