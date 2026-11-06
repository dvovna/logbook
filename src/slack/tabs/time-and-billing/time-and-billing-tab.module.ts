import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ClientsModule } from '@modules/clients/clients.module';
import { BillingReportFormSubmitHandler } from '@modules/slack/tabs/time-and-billing/handlers/billing-report-form-submit.handler';
import BillingReportModalViewValuesParser from '@modules/slack/tabs/time-and-billing/parsers/billing-report-modal-view-values.parser';
import { BillingReportModalView } from '@modules/slack/tabs/time-and-billing/views/billing-report-modal.view';
import TimeAndBillingTabActionHandler
  from '@modules/slack/tabs/time-and-billing/handlers/time-and-billing-tab-action.handler';
import { TimeAndBillingTabService } from '@modules/slack/tabs/time-and-billing/services/time-and-billing-tab.service';
import { TimeAndBillingTabView } from '@modules/slack/tabs/time-and-billing/views/time-and-billing-tab.view';

@Module({
  imports: [
    SlackCommonModule,
    TimeEntriesModule,
    ClientsModule,
  ],
  providers: [
    TimeAndBillingTabActionHandler,
    TimeAndBillingTabService,
    TimeAndBillingTabView,
    BillingReportFormSubmitHandler,
    BillingReportModalViewValuesParser,
    BillingReportModalView,
  ],
  exports: [TimeAndBillingTabService],
})
export class TimeAndBillingTabModule {}
