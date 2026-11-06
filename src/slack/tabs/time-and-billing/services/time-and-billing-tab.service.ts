import { Injectable } from '@nestjs/common';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';
import BaseTabService, { IPublishBaseParams } from '@modules/slack/common/services/base-tab.service';
import { TimeAndBillingTabView } from '@modules/slack/tabs/time-and-billing/views/time-and-billing-tab.view';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';

export type IGetPeopleTabViewParams = IPublishBaseParams;

@Injectable()
export class TimeAndBillingTabService extends BaseTabService<never> {
  public constructor(
    private readonly timeAndBillingViewService: TimeAndBillingTabView,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly timeEntriesSummaryService: TimeEntriesSummaryService,
  ) {
    super(TabId.TimeAndBilling);
  }

  protected async getTabView(params: IGetPeopleTabViewParams) {
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
}
