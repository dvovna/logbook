import { RATE_ROLES } from 'src/projects/constants/rate-roles';
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
import { BillingReportService } from 'src/time-entries/services/billing-report.service';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { IReportsTabMetadata } from '@modules/slack/tabs/reports/views/reports-tab.view';

// The form closes once the client is checked, and Reports makes the report
// after the answer, once, and shows it as a table, which a modal cannot have.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.BillingReportFormSubmit,
  type: 'view_submission',
  allowedRoles: RATE_ROLES,
})
export class BillingReportFormSubmitHandler extends BaseModalFormSubmitHandler<
  object,
  IBillingReportFormViewData
> {
  public constructor(
    private readonly billingReportService: BillingReportService,
    private readonly tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
    formParser: BillingReportModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    data: IBillingReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ): Promise<void> {
    const clientId = data.clientId.value;

    await this.billingReportService.assertCanReport({ user, clientId });

    this.tabNavigationService.navigate<{
      user: IUserViewModel;
      metadata: IReportsTabMetadata;
    }>(TabId.Reports, {
      user,
      metadata: {
        report: { clientId, fromDate: data.fromDate, toDate: data.toDate },
      },
    });
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
