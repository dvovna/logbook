import { Module } from '@nestjs/common';
import HomeTabActionHandler from '@modules/slack/tabs/home/handlers/home-tab-action.handler';
import { HomeTabService } from '@modules/slack/tabs/home/services/home-tab.service';
import { HomeTabView } from '@modules/slack/tabs/home/views/home-tab.view';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { VacationRequestsTabModule } from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { CancelVacationRequestActionHandler } from '@modules/slack/tabs/home/handlers/cancel-vacation-request-action.handler';
import { TimeTrackingModule } from '@modules/slack/tabs/time-tracking/time-tracking.module';

@Module({
  imports: [
    SlackCommunicationModule,
    SlackCommonModule,
    VacationRequestsModule,
    VacationRequestsTabModule,
    TimeTrackingModule,
  ],
  providers: [
    HomeTabView,
    HomeTabActionHandler,
    HomeTabService,
    CancelVacationRequestActionHandler,
  ],
  exports: [HomeTabService],
})
export class HomeTabModule {}
