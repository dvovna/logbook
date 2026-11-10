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
import { TimeReportModalView } from '@modules/slack/tabs/reports/views/time-report-modal.view';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  groupingOf,
  TimeReportKind,
} from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';
import { TimeReportService } from 'src/time-entries/services/time-report.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { MANAGER_ROLES } from '@common/constants/role-groups';

export type IGetReportsTabViewParams = IPublishBaseParams<IReportsTabMetadata>;

type ReportsModalViewResolversMap = {
  [key in ReportsModalName]: (params: IOpenModalBaseParams) => Promise<View>;
};

const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class ReportsTabService extends BaseTabService<ReportsModalViewResolversMap> {
  public constructor(
    private readonly reportsTabView: ReportsTabView,
    private readonly billingReportModalView: BillingReportModalView,
    private readonly timeReportModalView: TimeReportModalView,
    private readonly timeEntriesSummaryService: TimeEntriesSummaryService,
    private readonly billingReportService: BillingReportService,
    private readonly timeReportService: TimeReportService,
    private readonly clientsService: ClientsService,
  ) {
    super(TabId.Reports, {
      [ReportsModalName.BillingReport]: (params) =>
        this.getBillingReportModal(params),
      [ReportsModalName.TimeReport]: (params) =>
        this.getTimeReportModal(params),
    });
  }

  protected async getTabView({
    user,
    metadata = {},
  }: IGetReportsTabViewParams) {
    const { report, timeReport } = metadata;
    const [weekSummary, billingReport, timeReports] = await Promise.all([
      this.timeEntriesSummaryService.getWeekSummary(user),
      // The billing report is Admin's and HR's.
      report && isTimeEntriesAdmin(user.role)
        ? this.billingReportService.getClientReport({
            user,
            ...report,
          })
        : null,
      timeReport ? this.getTimeReports(user, timeReport) : null,
    ]);

    return this.reportsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        weekSummary,
        billingReport,
        timeReport: timeReports?.timeReport ?? null,
        missingTime: timeReports?.missingTime ?? null,
      },
      metadata,
    );
  }

  private async getTimeReports(
    user: IUserViewModel,
    { kind, fromDate, toDate }: NonNullable<IReportsTabMetadata['timeReport']>,
  ) {
    const groupBy = groupingOf(kind);

    return groupBy
      ? {
          timeReport: await this.timeReportService.getReport({
            user,
            groupBy,
            fromDate,
            toDate,
          }),
          missingTime: null,
        }
      : {
          timeReport: null,
          missingTime: await this.timeReportService.getMissingTime({
            user,
            fromDate,
            toDate,
          }),
        };
  }

  // For the current month up to today by default.
  private async getBillingReportModal({
    user,
    errorMessage,
  }: IOpenModalBaseParams) {
    const clients = await this.clientsService.findMany({
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    return this.billingReportModalView.getView({
      clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
      fromDate: `${today().slice(0, 8)}01`,
      toDate: today(),
      errorMessage,
    });
  }

  // Time by client, project, person or team for everyone; who hasn't
  // submitted for those who see other people's time. For the current month
  // up to today by default.
  private async getTimeReportModal({
    user,
    errorMessage,
  }: IOpenModalBaseParams) {
    return this.timeReportModalView.getView({
      kinds: Object.values(TimeReportKind).filter(
        (kind) =>
          kind !== TimeReportKind.Missing || MANAGER_ROLES.includes(user.role),
      ),
      fromDate: `${today().slice(0, 8)}01`,
      toDate: today(),
      errorMessage,
    });
  }
}
