import { Module } from '@nestjs/common';
import HomeTabActionHandler from 'src/slack/tabs/home/handlers/home-tab-action.handler';
import { HomeTabService } from 'src/slack/tabs/home/services/home-tab.service';
import { HomeTabView } from 'src/slack/tabs/home/views/home-tab.view';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { VacationRequestsTabModule } from 'src/slack/tabs/vacation-requests/vacation-requests-tab.module';

@Module({
  imports: [
    SlackCommunicationModule,
    SlackCommonModule,
    VacationRequestsModule,
    VacationRequestsTabModule,
  ],
  providers: [HomeTabView, HomeTabActionHandler, HomeTabService],
  exports: [HomeTabService],
})
export class HomeTabModule {}
