import { assertCanSeeRates } from 'src/projects/constants/rate-roles';
import { Injectable } from '@nestjs/common';
import { once } from 'lodash';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  IReportsPublishParams,
  ReportsTabService,
} from '@modules/slack/tabs/reports/services/reports-tab.service';
import {
  ReportsModalName,
  ReportsTabActionId,
} from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { groupingOf } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { IReportsTabMetadata } from '@modules/slack/tabs/reports/views/reports-tab.view';
import { TimeReportExportService } from '@modules/slack/tabs/reports/services/time-report-export.service';
import {
  CSV_ALREADY_SENDING_NOTICE,
  CSV_SENDING_NOTICE,
} from '@modules/slack/common/constants/csv-export';
import { ValidationError } from '@common/errors/validation.error';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';
import { assertCanManageSnapshots } from 'src/billing/constants/snapshot-roles';
import { TimeReportService } from 'src/time-entries/services/time-report.service';

// What the Reports view on show was made with (its private_metadata).
const metadataOf = (payload: ISlackInteractionPayload): IReportsTabMetadata => {
  try {
    return JSON.parse(payload.view?.private_metadata || '{}');
  } catch {
    return {};
  }
};

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReportsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Reports),
})
export default class ReportsTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
    private readonly timeReportExportService: TimeReportExportService,
    private readonly timeReportService: TimeReportService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [ReportsTabActionId.BillingReport]: this.handleBillingReports,
      [ReportsTabActionId.TimeReport]: this.handleTimeReport,
      [ReportsTabActionId.ExportTimeReport]: this.handleExportTimeReport,
      [ReportsTabActionId.LockSnapshot]: this.handleLockSnapshot,
      [ReportsTabActionId.Uninvoiced]: this.handleUninvoiced,
    };
  }

  // The billing report is Admin's and Finance's.
  private handleBillingReports = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    assertCanSeeRates(user);

    await this.reportsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ReportsModalName.BillingReport,
      { user },
    );
  };

  // Asks to confirm locking the billing report on show in a snapshot; the
  // form carries the view's metadata, which names the report.
  private handleLockSnapshot = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    assertCanManageSnapshots(user);

    if (!metadataOf(payload).report) {
      throw new ValidationError('Show a billing report first.');
    }

    await this.reportsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ReportsModalName.LockSnapshot,
      { user, pageMetadata: payload.view?.private_metadata ?? '{}' },
    );
  };

  private handleUninvoiced = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    assertCanManageSnapshots(user);

    await this.reportsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ReportsModalName.Uninvoiced,
      { user },
    );
  };

  private handleTimeReport = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.reportsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ReportsModalName.TimeReport,
      { user },
    );
  };

  // Sends the entries of the time report on show as a CSV file in a DM. The
  // upload takes longer than Slack waits for an answer, so it is a job,
  // saved before the answer; the export keeps to the user's own scope
  // whatever the metadata says. The report is made once, for the CSV and for
  // Reports shown again with the notice.
  private handleExportTimeReport = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const metadata = metadataOf(payload);
    const { timeReport } = metadata;
    const groupBy = timeReport && groupingOf(timeReport.kind);

    if (!timeReport || !groupBy) {
      throw new ValidationError('Show a time report first.');
    }

    const { fromDate, toDate, clientId, projectId, userId } = timeReport;
    const params = {
      groupBy,
      fromDate,
      toDate,
      filters: { clientId, projectId, userId },
    };

    assertReportPeriod(fromDate, toDate);

    const report = once(() =>
      this.timeReportService.getReport({ user, ...params }),
    );
    const sending = await this.timeReportExportService.start(
      user,
      params,
      report,
    );

    this.tabNavigationService.navigate<IReportsPublishParams>(TabId.Reports, {
      user,
      metadata,
      notice: sending ? CSV_SENDING_NOTICE : CSV_ALREADY_SENDING_NOTICE,
      timeReport: report(),
    });
  };
}
