import { Module } from '@nestjs/common';
import HomeTabActionHandler from 'src/slack/tabs/home/handlers/home-tab-action.handler';
import { HomeTabService } from 'src/slack/tabs/home/services/home-tab.service';
import { HomeTabView } from 'src/slack/tabs/home/views/home-tab.view';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { VacationRequestsTabModule } from 'src/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { CancelVacationRequestActionHandler } from 'src/slack/tabs/home/handlers/cancel-vacation-request-action.handler';
import { CancelVacationRequestCommandSubmitHandler } from 'src/slack/tabs/home/handlers/cancel-vacation-request-command-submit.handler';
import CancelVacationRequestModalViewValuesParser from 'src/slack/tabs/home/parsers/cancel-vacation-request-modal-view-values.parser';
import { CancelVacationRequestSelectModalView } from 'src/slack/tabs/home/views/cancel-vacation-request-select-modal.view';

@Module({
  imports: [
    SlackCommunicationModule,
    SlackCommonModule,
    VacationRequestsModule,
    VacationRequestsTabModule,
  ],
  providers: [
    HomeTabView,
    HomeTabActionHandler,
    HomeTabService,
    CancelVacationRequestActionHandler,
    CancelVacationRequestCommandSubmitHandler,
    CancelVacationRequestModalViewValuesParser,
    CancelVacationRequestSelectModalView,
  ],
  exports: [HomeTabService, CancelVacationRequestSelectModalView],
})
export class HomeTabModule {}
