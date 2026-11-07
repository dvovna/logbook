import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import ClientsService from '@modules/clients/services/clients.service';
import {
  IReportsTabMetadata,
  ReportsTabView,
} from '@modules/slack/tabs/reports/views/reports-tab.view';
import { BillingReportService } from 'src/time-entries/services/billing-report.service';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { BillingReportModalView } from '@modules/slack/tabs/reports/views/billing-report-modal.view';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';

export type IGetReportsTabViewParams = IPublishBaseParams<IReportsTabMetadata>;

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
    private readonly billingReportService: BillingReportService,
    private readonly clientsService: ClientsService,
  ) {
    super(TabId.Reports, {
      [ReportsModalName.BillingReport]: (params) =>
        this.getBillingReportModal(params),
    });
  }

  protected async getTabView({
    user,
    metadata = {},
  }: IGetReportsTabViewParams) {
    const { report } = metadata;
    const [weekSummary, billingReport] = await Promise.all([
      this.timeEntriesSummaryService.getWeekSummary(user),
      // The report is Admin's and HR's.
      report && isTimeEntriesAdmin(user.role)
        ? this.billingReportService.getClientReport({
            slackTeamId: user.slack_team_id,
            ...report,
          })
        : null,
    ]);

    return this.reportsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        weekSummary,
        billingReport,
      },
      metadata,
    );
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
