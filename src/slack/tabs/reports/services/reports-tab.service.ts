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
import { ValidationError } from '@common/errors/validation.error';
import { formatDateRange } from '@common/utils/date.utils';
import { formatMoney } from '@common/utils/money.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { UninvoicedReportService } from 'src/billing/services/uninvoiced-report.service';
import { canManageSnapshots } from 'src/billing/constants/snapshot-roles';

export type IGetReportsTabViewParams = IPublishBaseParams<IReportsTabMetadata>;

type ReportsModalViewResolversMap = {
  [ReportsModalName.BillingReport]: (
    params: IOpenModalBaseParams,
  ) => Promise<View>;
  [ReportsModalName.TimeReport]: (
    params: IOpenModalBaseParams,
  ) => Promise<View>;
  // The Reports view's metadata, with the billing report on show.
  [ReportsModalName.LockSnapshot]: (
    params: IOpenModalBaseParams<string>,
  ) => Promise<View>;
};

// The billing report a view's metadata names, if any.
export const billingReportOf = (
  metadata: string | undefined,
): IReportsTabMetadata['report'] | undefined => {
  try {
    return (JSON.parse(metadata || '{}') as IReportsTabMetadata).report;
  } catch {
    return undefined;
  }
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
    private readonly uninvoicedReportService: UninvoicedReportService,
    private readonly billingSnapshotsService: BillingSnapshotsService,
    private readonly confirmationModalView: ConfirmationModalView,
  ) {
    super(TabId.Reports, {
      [ReportsModalName.BillingReport]: (params) =>
        this.getBillingReportModal(params),
      [ReportsModalName.TimeReport]: (params) =>
        this.getTimeReportModal(params),
      [ReportsModalName.LockSnapshot]: (params) =>
        this.getLockSnapshotModal(params),
    });
  }

  protected async getTabView({
    user,
    metadata = {},
  }: IGetReportsTabViewParams) {
    const { report, timeReport, uninvoiced } = metadata;
    const [weekSummary, billingReport, timeReports, uninvoicedReport] =
      await Promise.all([
        this.timeEntriesSummaryService.getWeekSummary(user),
        // The billing report is Admin's and HR's.
        report && isTimeEntriesAdmin(user.role)
          ? this.billingReportService.getClientReport({
              user,
              ...report,
            })
          : null,
        timeReport ? this.getTimeReports(user, timeReport) : null,
        // As billing snapshots, Admin's and HR's.
        uninvoiced && canManageSnapshots(user.role)
          ? this.uninvoicedReportService.getReport(user)
          : null,
      ]);

    return this.reportsTabView.getView(
      {
        userId: user.slack_id,
        userRole: user.role,
        weekSummary,
        billingReport,
        timeReport: timeReports?.timeReport ?? null,
        missingTime: timeReports?.missingTime ?? null,
        uninvoiced: uninvoicedReport,
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

  // What locking the billing report on show would take: its approved time
  // that isn't in a snapshot yet.
  private async getLockSnapshotModal({
    user,
    pageMetadata,
    errorMessage,
  }: IOpenModalBaseParams<string>) {
    const report = billingReportOf(pageMetadata);

    if (!report) {
      throw new ValidationError('Show a billing report first.');
    }

    const preview = await this.billingSnapshotsService.preview({
      user,
      ...report,
    });
    const money = (cents: number) => formatMoney(cents, preview.currency);
    const period = formatDateRange(preview.fromDate, preview.toDate);
    const entries = `${preview.entryCount} ${preview.entryCount === 1 ? 'entry' : 'entries'}`;

    return this.confirmationModalView.getView(
      {
        callbackId: ViewCallbackId.CreateBillingSnapshot,
        title: 'Lock in a snapshot',
        confirmText: 'Lock',
        message: preview.entryCount
          ? [
              `*${escapeMrkdwn(preview.clientName)}* · ${period}: the approved time that isn't in a snapshot yet.`,
              `• ${entries}, *${getDisplayTime(preview.totalMinutes)}*, billable *${preview.billableMinutes ? getDisplayTime(preview.billableMinutes) : '0h'}*`,
              `• Amount: *${money(preview.amountCents)}* at today's rates, kept with the snapshot`,
              preview.unratedMinutes &&
                `_No rate: ${getDisplayTime(preview.unratedMinutes)} of billable time, which gets no amount._`,
              'Nobody can change these entries until an admin unlocks the snapshot.',
            ]
              .filter(Boolean)
              .join('\n')
          : `No approved time of *${escapeMrkdwn(preview.clientName)}* in ${period} is left outside snapshots.`,
        errorMessage,
      },
      { id: report.clientId, pageMetadata },
    );
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
