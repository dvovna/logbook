import { Module } from '@nestjs/common';
import HomeTabActionHandler from '@modules/slack/tabs/home/handlers/home-tab-action.handler';
import {
  HomeTabService,
} from '@modules/slack/tabs/home/services/home-tab.service';
import { HomeTabView } from '@modules/slack/tabs/home/views/home-tab.view';
import {
  SlackCommunicationModule,
} from '@modules/slack-communication/slack-communication.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import {
  VacationRequestsModule,
} from '@modules/vacation-requests/vacation-requests.module';
import {
  VacationRequestsTabModule,
} from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import {
  CancelVacationRequestActionHandler,
} from '@modules/slack/tabs/home/handlers/cancel-vacation-request-action.handler';
import {
  TimeTrackingModule,
} from '@modules/slack/tabs/time-tracking/time-tracking.module';
import {
  CancelVacationRequestCommandSubmitHandler,
} from '@modules/slack/tabs/home/handlers/cancel-vacation-request-command-submit.handler';
import CancelVacationRequestModalViewValuesParser from '@modules/slack/tabs/home/parsers/cancel-vacation-request-modal-view-values.parser';
import {
  CancelVacationRequestSelectModalView,
} from '@modules/slack/tabs/home/views/cancel-vacation-request-select-modal.view';

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
    CancelVacationRequestCommandSubmitHandler,
    CancelVacationRequestModalViewValuesParser,
    CancelVacationRequestSelectModalView,
  ],
  exports: [HomeTabService, CancelVacationRequestSelectModalView],
})
export class HomeTabModule {}
