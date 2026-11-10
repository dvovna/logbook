import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import UninvoicedReportModalViewValuesParser, {
  IUninvoicedReportFormViewData,
} from '@modules/slack/tabs/reports/parsers/uninvoiced-report-modal-view-values.parser';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import { IReportsTabMetadata } from '@modules/slack/tabs/reports/views/reports-tab.view';
import { SNAPSHOT_ROLES } from 'src/billing/constants/snapshot-roles';

// Shows what isn't invoiced in the period on Reports; the service checks the
// role and the period again when it makes the report.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UninvoicedReportFormSubmit,
  type: 'view_submission',
  allowedRoles: SNAPSHOT_ROLES,
})
export class UninvoicedReportFormSubmitHandler extends BaseModalFormSubmitHandler<
  object,
  IUninvoicedReportFormViewData
> {
  public constructor(
    private readonly tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
    formParser: UninvoicedReportModalViewValuesParser,
  ) {
    super(formParser);
  }

  protected async onSubmit(
    { fromDate, toDate }: IUninvoicedReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ): Promise<void> {
    this.tabNavigationService.navigate<{
      user: IUserViewModel;
      metadata: IReportsTabMetadata;
    }>(TabId.Reports, {
      user,
      metadata: {
        uninvoiced: {
          ...(fromDate ? { fromDate } : {}),
          ...(toDate ? { toDate } : {}),
        },
      },
    });
  }

  protected successResponse() {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: IUninvoicedReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.reportsTabService.getModalView(ReportsModalName.Uninvoiced, {
        user,
        errorMessage,
      }),
    );
  }
}
