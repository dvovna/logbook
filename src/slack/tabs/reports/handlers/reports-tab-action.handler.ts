import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { TIME_ENTRIES_ADMIN_ROLES } from 'src/time-entries/constants/time-entries-admin-roles';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import {
  ReportsModalName,
  ReportsTabActionId,
} from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { TimeReportKind } from '@modules/slack/tabs/reports/enums/time-report-kind.enum';
import { IReportsTabMetadata } from '@modules/slack/tabs/reports/views/reports-tab.view';
import { TimeReportExportService } from '@modules/slack/tabs/reports/services/time-report-export.service';
import { runInBackground } from '@common/utils/run-in-background';
import { ValidationError } from '@common/errors/validation.error';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';

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
  private readonly logger = new Logger(ReportsTabActionHandler.name);

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
    private readonly timeReportExportService: TimeReportExportService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [ReportsTabActionId.BillingReport]: this.handleBillingReports,
      [ReportsTabActionId.TimeReport]: this.handleTimeReport,
      [ReportsTabActionId.ExportTimeReport]: this.handleExportTimeReport,
    };
  }

  // The billing report is Admin's and HR's.
  private handleBillingReports = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    if (!TIME_ENTRIES_ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Admin and HR make billing reports');
    }

    await this.reportsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ReportsModalName.BillingReport,
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
  // upload takes longer than Slack waits for an answer, so it runs after it;
  // the export keeps to the user's own scope whatever the metadata says.
  private handleExportTimeReport = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    const metadata = metadataOf(payload);
    const { timeReport } = metadata;

    if (!timeReport || timeReport.kind === TimeReportKind.Missing) {
      throw new ValidationError('Show a time report first.');
    }

    assertReportPeriod(timeReport.fromDate, timeReport.toDate);

    runInBackground(this.logger, 'send a time report as CSV', () =>
      this.timeReportExportService.send(user, timeReport),
    );

    this.tabNavigationService.navigate(TabId.Reports, {
      user,
      metadata,
      notice: '📨 Sending the CSV to your DMs.',
    });
  };
}
