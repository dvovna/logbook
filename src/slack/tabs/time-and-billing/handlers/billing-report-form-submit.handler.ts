import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import BillingReportModalViewValuesParser, {
  IBillingReportFormViewData,
} from '@modules/slack/tabs/time-and-billing/parsers/billing-report-modal-view-values.parser';
import { BillingReportModalView } from '@modules/slack/tabs/time-and-billing/views/billing-report-modal.view';
import { TimeAndBillingTabService } from '@modules/slack/tabs/time-and-billing/services/time-and-billing-tab.service';
import { TimeAndBillingModalName } from '@modules/slack/tabs/time-and-billing/enums/time-and-billing-modal-name.enum';
import {
  BillingReportService,
  IBillingReport,
} from 'src/time-entries/services/billing-report.service';
import { TIME_ENTRIES_ADMIN_ROLES } from 'src/time-entries/constants/time-entries-admin-roles';

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
    private readonly billingReportModalView: BillingReportModalView,
    private readonly timeAndBillingTabService: TimeAndBillingTabService,
    formParser: BillingReportModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected onSubmit(
    data: IBillingReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ) {
    return this.billingReportService.getClientReport({
      slackTeamId: user.slack_team_id,
      clientId: data.clientId.value,
      fromDate: data.fromDate,
      toDate: data.toDate,
    });
  }

  protected successResponse(report: IBillingReport) {
    return SlackViewResponseFactory.push(
      this.billingReportModalView.getReportView(report),
    );
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IBillingReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.timeAndBillingTabService.getModalView(
        TimeAndBillingModalName.BillingReport,
        { user, errorMessage },
      ),
    );
  }
}
