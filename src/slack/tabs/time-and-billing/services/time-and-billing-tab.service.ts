import { Injectable } from '@nestjs/common';
import { View } from '@slack/types/dist/views';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, {
  IOpenModalBaseParams,
  IPublishBaseParams,
} from '@modules/slack/common/services/base-tab.service';
import ClientsService from '@modules/clients/services/clients.service';
import { TimeAndBillingTabView } from '@modules/slack/tabs/time-and-billing/views/time-and-billing-tab.view';
import { BillingReportModalView } from '@modules/slack/tabs/time-and-billing/views/billing-report-modal.view';
import { TimeAndBillingModalName } from '@modules/slack/tabs/time-and-billing/enums/time-and-billing-modal-name.enum';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';

export type IGetTimeAndBillingTabViewParams = IPublishBaseParams;

type TimeAndBillingModalViewResolversMap = {
  [TimeAndBillingModalName.BillingReport]: (
    params: IOpenModalBaseParams,
  ) => Promise<View>;
};

@Injectable()
export class TimeAndBillingTabService extends BaseTabService<TimeAndBillingModalViewResolversMap> {
  public constructor(
    private readonly timeAndBillingViewService: TimeAndBillingTabView,
    private readonly billingReportModalView: BillingReportModalView,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly timeEntriesSummaryService: TimeEntriesSummaryService,
    private readonly clientsService: ClientsService,
  ) {
    super(TabId.TimeAndBilling, {
      [TimeAndBillingModalName.BillingReport]: (params) =>
        this.getBillingReportModal(params),
    });
  }

  protected async getTabView(params: IGetTimeAndBillingTabViewParams) {
    const [pendingApprovals, weekSummary] = await Promise.all([
      this.timeEntryApprovalsService.countPending(params.user),
      this.timeEntriesSummaryService.getWorkspaceSummary(
        params.user.slack_team_id,
      ),
    ]);

    return this.timeAndBillingViewService.getView({
      userId: params.user.slack_id,
      userRole: params.user.role,
      pendingApprovals,
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
