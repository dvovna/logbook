import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import TimeAndBillingTabActionHandler
  from '@modules/slack/tabs/time-and-billing/handlers/time-and-billing-tab-action.handler';
import { TimeAndBillingTabService } from '@modules/slack/tabs/time-and-billing/services/time-and-billing-tab.service';
import { TimeAndBillingTabView } from '@modules/slack/tabs/time-and-billing/views/time-and-billing-tab.view';

@Module({
  imports: [
    SlackCommonModule,
    TimeEntriesModule,
  ],
  providers: [
    TimeAndBillingTabActionHandler,
    TimeAndBillingTabService,
    TimeAndBillingTabView,
  ],
  exports: [TimeAndBillingTabService],
})
export class TimeAndBillingTabModule {}
