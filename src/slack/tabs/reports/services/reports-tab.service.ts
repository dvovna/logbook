import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import ClientsService from '@modules/clients/services/clients.service';
import { ReportsTabView } from '@modules/slack/tabs/reports/views/reports-tab.view';
import { BillingReportModalView } from '@modules/slack/tabs/reports/views/billing-report-modal.view';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';

export type IGetReportsTabViewParams = IPublishBaseParams;

type ReportsModalViewResolversMap = {
  [ReportsModalName.BillingReport]: (
    params: IOpenModalBaseParams,
  ) => Promise<View>;
};

@Injectable()
export class ReportsTabService extends BaseTabService<ReportsModalViewResolversMap> {
  public constructor(
    private readonly reportsTabView: ReportsTabView,
    private readonly billingReportModalView: BillingReportModalView,
    private readonly timeEntriesSummaryService: TimeEntriesSummaryService,
    private readonly clientsService: ClientsService,
  ) {
    super(TabId.Reports, {
      [ReportsModalName.BillingReport]: (params) =>
        this.getBillingReportModal(params),
    });
  }

  protected async getTabView(params: IGetReportsTabViewParams) {
    const weekSummary = await this.timeEntriesSummaryService.getWeekSummary(
      params.user,
    );

    return this.reportsTabView.getView({
      userId: params.user.slack_id,
      userRole: params.user.role,
      weekSummary,
    });
  }

  // For the current month up to today by default.
  private async getBillingReportModal({
    user,
    errorMessage,
  }: IOpenModalBaseParams) {
    const today = new Date().toISOString().slice(0, 10);
    const clients = await this.clientsService.findMany({
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    return this.billingReportModalView.getView({
      clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
      fromDate: `${today.slice(0, 8)}01`,
      toDate: today,
      errorMessage,
    });
  }
}
