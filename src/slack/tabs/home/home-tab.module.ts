import { Module } from '@nestjs/common';
import { SetupProgressService } from '@modules/slack/tabs/home/services/setup-progress.service';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import HomeTabActionHandler from '@modules/slack/tabs/home/handlers/home-tab-action.handler';
import { HomeTabService } from '@modules/slack/tabs/home/services/home-tab.service';
import { HomeTabView } from '@modules/slack/tabs/home/views/home-tab.view';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { VacationRequestsTabModule } from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { CancelVacationRequestActionHandler } from '@modules/slack/tabs/home/handlers/cancel-vacation-request-action.handler';
import { TimeTrackingModule } from '@modules/slack/tabs/time-tracking/time-tracking.module';
import { CancelVacationRequestCommandSubmitHandler } from '@modules/slack/tabs/home/handlers/cancel-vacation-request-command-submit.handler';
import CancelVacationRequestModalViewValuesParser from '@modules/slack/tabs/home/parsers/cancel-vacation-request-modal-view-values.parser';
import { CancelVacationRequestSelectModalView } from '@modules/slack/tabs/home/views/cancel-vacation-request-select-modal.view';
import { TeamsTabModule } from '@modules/slack/tabs/teams/teams-tab.module';
import { LeaveFileSlackModule } from '@modules/slack/leave-file/leave-file-slack.module';
import { LeaveFileModule } from 'src/leave-file/leave-file.module';
import { TeamFileSlackModule } from '@modules/slack/team-file/team-file-slack.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ReceiptsModule } from 'src/receipts/receipts.module';
import { RequesterNoticeMessageHandler } from '@modules/slack/tabs/home/handlers/requester-notice-message.handler';

@Module({
  imports: [
    VacationPoliciesModule,
    TeamsModule,
    UsersModule,
    ProjectsModule,
    SlackCommunicationModule,
    SlackCommonModule,
    VacationRequestsModule,
    VacationRequestsTabModule,
    TimeTrackingModule,
    TimeEntriesModule,
    TeamsTabModule,
    TeamFileSlackModule,
    LeaveFileSlackModule,
    LeaveFileModule,
    ReceiptsModule,
    SlackTeamsModule,
  ],
  providers: [
    SetupProgressService,
    HomeTabView,
    HomeTabActionHandler,
    HomeTabService,
    CancelVacationRequestActionHandler,
    CancelVacationRequestCommandSubmitHandler,
    CancelVacationRequestModalViewValuesParser,
    CancelVacationRequestSelectModalView,
    RequesterNoticeMessageHandler,
  ],
  exports: [HomeTabService, CancelVacationRequestSelectModalView],
})
export class HomeTabModule {}
