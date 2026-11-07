import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import BillingReportModalViewValuesParser, {
  IBillingReportFormViewData,
} from '@modules/slack/tabs/reports/parsers/billing-report-modal-view-values.parser';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  BillingReportService,
  IBillingReport,
} from 'src/time-entries/services/billing-report.service';
import { TIME_ENTRIES_ADMIN_ROLES } from 'src/time-entries/constants/time-entries-admin-roles';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { IReportsTabMetadata } from '@modules/slack/tabs/reports/views/reports-tab.view';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.BillingReportFormSubmit,
  type: 'view_submission',
  allowedRoles: TIME_ENTRIES_ADMIN_ROLES,
})
export class BillingReportFormSubmitHandler extends BaseModalFormSubmitHandler<
  object,
  IBillingReportFormViewData,
  IBillingReport
> {
  public constructor(
    private readonly billingReportService: BillingReportService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
    formParser: BillingReportModalViewValuesParser,
  ) {
    super(formParser);
  }

  // Checked here, so the form can say what is wrong; Reports then shows it
  // as a table, which a modal cannot have.
  protected async onSubmit(
    data: IBillingReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ): Promise<IBillingReport> {
    const report = await this.billingReportService.getClientReport({
      slackTeamId: user.slack_team_id,
      clientId: data.clientId.value,
      fromDate: data.fromDate,
      toDate: data.toDate,
    });

    this.tabNavigationService.navigate<{
      user: IUserViewModel;
      metadata: IReportsTabMetadata;
    }>(TabId.Reports, {
      user,
      metadata: {
        report: {
          clientId: data.clientId.value,
          fromDate: data.fromDate,
          toDate: data.toDate,
        },
      },
    });

    return report;
  }

  protected successResponse() {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IBillingReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.reportsTabService.getModalView(
        ReportsModalName.BillingReport,
        { user, errorMessage },
      ),
    );
  }
}
