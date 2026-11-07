import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ClientsModule } from '@modules/clients/clients.module';
import { BillingReportFormSubmitHandler } from '@modules/slack/tabs/reports/handlers/billing-report-form-submit.handler';
import BillingReportModalViewValuesParser from '@modules/slack/tabs/reports/parsers/billing-report-modal-view-values.parser';
import { BillingReportModalView } from '@modules/slack/tabs/reports/views/billing-report-modal.view';
import ReportsTabActionHandler from '@modules/slack/tabs/reports/handlers/reports-tab-action.handler';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import { ReportsTabView } from '@modules/slack/tabs/reports/views/reports-tab.view';

@Module({
  imports: [SlackCommonModule, TimeEntriesModule, ClientsModule],
  providers: [
    ReportsTabActionHandler,
    ReportsTabService,
    ReportsTabView,
    BillingReportFormSubmitHandler,
    BillingReportModalViewValuesParser,
    BillingReportModalView,
  ],
  exports: [ReportsTabService],
})
export class ReportsTabModule {}
