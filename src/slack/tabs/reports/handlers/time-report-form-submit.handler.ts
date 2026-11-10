import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import TimeReportModalViewValuesParser, {
  ITimeReportFormViewData,
} from '@modules/slack/tabs/reports/parsers/time-report-modal-view-values.parser';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import { ReportsModalName } from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { IReportsTabMetadata } from '@modules/slack/tabs/reports/views/reports-tab.view';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';

// Everyone who sees Reports makes time reports; the services keep each of
// them to the time they may see.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeReportFormSubmit,
  type: 'view_submission',
  allowedRoles: rolesOfTab(TabId.Reports),
})
export class TimeReportFormSubmitHandler extends BaseModalFormSubmitHandler<
  object,
  ITimeReportFormViewData
> {
  public constructor(
    private readonly tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
    formParser: TimeReportModalViewValuesParser,
  ) {
    super(formParser);
  }

  // The form closes, and Reports shows the report, with a table a modal
  // cannot have.
  protected async onSubmit(
    { kind, fromDate, toDate }: ITimeReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ): Promise<void> {
    assertReportPeriod(fromDate, toDate);

    this.tabNavigationService.navigate<{
      user: IUserViewModel;
      metadata: IReportsTabMetadata;
    }>(TabId.Reports, {
      user,
      metadata: { timeReport: { kind: kind.value, fromDate, toDate } },
    });
  }

  protected successResponse() {
    return SlackViewResponseFactory.success();
  }

  protected async errorResponse(
    errorMessage: string,
    _data: ITimeReportFormViewData,
    _meta: object,
    user: IUserViewModel,
  ) {
    return SlackViewResponseFactory.update(
      await this.reportsTabService.getModalView(ReportsModalName.TimeReport, {
        user,
        errorMessage,
      }),
    );
  }
}
