import { canSeeRates } from 'src/projects/constants/rate-roles';
import { Injectable, Logger } from '@nestjs/common';
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
import { BillingReportModalView } from '@modules/slack/tabs/reports/views/billing-report-modal.view';
import { TimeReportModalView } from '@modules/slack/tabs/reports/views/time-report-modal.view';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  groupingOf,
  TimeReportKind,
} from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';
import { TimeReportService } from 'src/time-entries/services/time-report.service';
import { ITimeReport } from 'src/time-entries/types/time-report.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { OTHERS_TIME_ROLES } from '@common/constants/role-groups';
import { ValidationError } from '@common/errors/validation.error';
import { formatDateRange } from '@common/utils/date.utils';
import { todayIso } from '@common/utils/period-presets';
import { formatMoney } from '@common/utils/money.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { runInBackground } from '@common/utils/run-in-background';
import { classifyActionError } from '@modules/slack/common/utils/action-errors';
import ConfirmationModalView from '@modules/slack/common/views/components/confirmation-modal.view';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { UninvoicedReportService } from 'src/billing/services/uninvoiced-report.service';
import { canManageSnapshots } from 'src/billing/constants/snapshot-roles';
import { UninvoicedReportModalView } from '@modules/slack/tabs/reports/views/uninvoiced-report-modal.view';

export interface IReportsPublishParams extends IPublishBaseParams<IReportsTabMetadata> {
  // The time report the metadata names, when the caller made it already
  // (Export makes it for the CSV too).
  timeReport?: Promise<ITimeReport>;
}

// A report form's period, as a quick period filled it
// (ReportFormPresetHandler): new dates, under new block_ids.
export interface IFormPeriod {
  fromDate?: string;
  toDate?: string;
  version: string;
}

export type IReportFormParams = IOpenModalBaseParams & { period?: IFormPeriod };

type ReportsModalViewResolversMap = {
  [ReportsModalName.BillingReport]: (
    params: IReportFormParams,
  ) => Promise<View>;
  [ReportsModalName.TimeReport]: (params: IReportFormParams) => Promise<View>;
  [ReportsModalName.Uninvoiced]: (params: IReportFormParams) => Promise<View>;
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

const LOCK_SNAPSHOT_TITLE = 'Lock in a snapshot';

// The confirmation until it knows what it would lock: nothing to confirm.
const LOCK_SNAPSHOT_PENDING: View = {
  type: 'modal',
  title: { type: 'plain_text', text: LOCK_SNAPSHOT_TITLE },
  close: { type: 'plain_text', text: 'Cancel' },
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: "⏳ Adding up the approved time that isn't in a snapshot yet…",
      },
    },
  ],
};

// A dated form's period: the quick period's, else this month up to today.
const datedPeriod = (period?: IFormPeriod) => ({
  fromDate: period ? period.fromDate : `${todayIso().slice(0, 8)}01`,
  toDate: period ? period.toDate : todayIso(),
  version: period?.version,
});

@Injectable()
export class ReportsTabService extends BaseTabService<
  ReportsModalViewResolversMap,
  IReportsPublishParams
> {
  private readonly reportsLogger = new Logger(ReportsTabService.name);

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
    private readonly uninvoicedReportModalView: UninvoicedReportModalView,
  ) {
    super(TabId.Reports, {
      [ReportsModalName.BillingReport]: (params) =>
        this.getBillingReportModal(params),
      [ReportsModalName.TimeReport]: (params) =>
        this.getTimeReportModal(params),
      [ReportsModalName.Uninvoiced]: (params) =>
        this.getUninvoicedModal(params),
      [ReportsModalName.LockSnapshot]: (params) =>
        this.getLockSnapshotModal(params),
    });
  }

  protected async getTabView({
    user,
    metadata = {},
    timeReport: madeReport,
  }: IReportsPublishParams) {
    const { report, timeReport, uninvoiced } = metadata;
    const [weekSummary, billingReport, timeReports, uninvoicedReport] =
      await Promise.all([
        this.timeEntriesSummaryService.getWeekSummary(user),
        // The billing report is Admin's and Finance's.
        report && canSeeRates(user.role)
          ? this.billingReportService.getClientReport({
              user,
              ...report,
            })
          : null,
        timeReport ? this.getTimeReports(user, timeReport, madeReport) : null,
        // As billing snapshots, Admin's and Finance's.
        uninvoiced && canManageSnapshots(user.role)
          ? this.uninvoicedReportService.getReport(user, uninvoiced)
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
    {
      kind,
      fromDate,
      toDate,
      ...filters
    }: NonNullable<IReportsTabMetadata['timeReport']>,
    madeReport?: Promise<ITimeReport>,
  ) {
    const groupBy = groupingOf(kind);

    return groupBy
      ? {
          timeReport: await (madeReport ??
            this.timeReportService.getReport({
              user,
              groupBy,
              fromDate,
              toDate,
              filters,
            })),
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
    period,
  }: IReportFormParams) {
    const clients = await this.clientsService.findMany({
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    return this.billingReportModalView.getView({
      clients: clients.sort((a, b) => a.name.localeCompare(b.name)),
      ...datedPeriod(period),
      errorMessage,
    });
  }

  // All time by default: no dates.
  private async getUninvoicedModal({
    errorMessage,
    period,
  }: IReportFormParams) {
    return this.uninvoicedReportModalView.getView({
      fromDate: period?.fromDate,
      toDate: period?.toDate,
      version: period?.version,
      errorMessage,
    });
  }

  // Opens the confirmation at once, while the click's trigger_id lives (3
  // seconds), and puts in what it would lock after the answer: adding up a
  // year of a big client's time can take longer.
  public async openLockSnapshotModal(
    triggerId: string,
    params: IOpenModalBaseParams<string>,
  ) {
    const { view } = await this.slackCommunicationService.openView(
      triggerId,
      LOCK_SNAPSHOT_PENDING,
      params.user.slack_team_id,
    );

    if (view?.id) {
      const { id, hash } = view;

      runInBackground(
        this.reportsLogger,
        'show what a snapshot would lock',
        () => this.showLockSnapshotPreview(id, hash, params),
      );
    }
  }

  // The confirmation `views.open` opened, with what it would lock, or with
  // why that couldn't be worked out. `hash` is the opened view's: an update
  // never replaces a view that changed since.
  private async showLockSnapshotPreview(
    viewId: string,
    hash: string | undefined,
    params: IOpenModalBaseParams<string>,
  ) {
    let view: View;
    let unexpected: unknown = null;

    try {
      view = await this.getLockSnapshotModal(params);
    } catch (error) {
      const kind = classifyActionError(error);

      unexpected = kind === 'unexpected' || kind === 'not-found' ? error : null;
      view = this.confirmationModalView.getErrorView(
        LOCK_SNAPSHOT_TITLE,
        unexpected
          ? "Couldn't add up the time to lock. Please try again."
          : (error as Error).message,
      );
    }

    await this.slackCommunicationService.updateView(
      viewId,
      view,
      params.user.slack_team_id,
      hash,
    );

    if (unexpected) {
      throw unexpected;
    }
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
        title: LOCK_SNAPSHOT_TITLE,
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
  // up to today by default. Those who see others' time may filter by client
  // and person too; everyone by project.
  private async getTimeReportModal({
    user,
    errorMessage,
    period,
  }: IReportFormParams) {
    const seesOthers = OTHERS_TIME_ROLES.includes(user.role);
    const clients = seesOthers
      ? await this.clientsService.findMany({
          slackTeamId: user.slack_team_id,
          includeArchived: true,
        })
      : [];

    return this.timeReportModalView.getView({
      kinds: Object.values(TimeReportKind).filter(
        (kind) => kind !== TimeReportKind.Missing || seesOthers,
      ),
      ...datedPeriod(period),
      clients: clients
        .map(({ id, name }) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      withPerson: seesOthers,
      errorMessage,
    });
  }
}
