import { ApprovalsModule } from '@modules/slack/approvals/approvals.module';
import { MiddlewareConsumer, Module } from '@nestjs/common';
import SlackOauthController from '@modules/slack/controllers/slack-oauth.controller';
import SlackOauthService from '@modules/slack/services/slack-oauth.service';
import { ApiClientsModule } from 'src/api-clients/api-clients.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { UsersModule } from '@modules/users/users.module';
import SlackCommandsController from '@modules/slack/controllers/slack-commands.controller';
import VacationCommandService from '@modules/slack/services/vacation-command.service';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import SlackInteractionsController from '@modules/slack/controllers/slack-interactions.controller';
import SlackInteractionsService from '@modules/slack/services/slack-interactions.service';
import SlackUserAccessService from '@modules/slack/services/slack-user-access.service';
import { TeamSetupModule } from '@modules/team-setup/team-setup.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import SlackEventsController from '@modules/slack/controllers/slack-events.controller';
import SlackEventsService from '@modules/slack/services/slack-events.service';
import FileUploadService from '@modules/slack/services/file-upload.service';
import { SlackPayloadParsePipe } from '@modules/slack/pipes/slack-payload-parse.pipe';
import { SlackPayloadParseMiddleware } from '@common/middlewares/slack-payload-parse.middleware';
import { TeamsModule } from '@modules/teams/teams.module';
import { SlackHandlersRegistry } from '@modules/slack/slack-handlers.registry';
import { DiscoveryModule } from '@nestjs/core';
import { HolidaysModule } from '@modules/holidays/holidays.module';
import { SlackOptionsController } from '@modules/slack/controllers/slack-options.controller';
import { VacationRequestsTabModule } from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { HolidaysTabModule } from '@modules/slack/tabs/holidays/holidays-tab.module';
import { VacationPoliciesTabModule } from '@modules/slack/tabs/vacation-policies/vacation-policies-tab.module';
import { TeamsTabModule } from '@modules/slack/tabs/teams/teams-tab.module';
import { UsersTabModule } from '@modules/slack/tabs/users/users-tab.module';
import { HomeTabModule } from '@modules/slack/tabs/home/home-tab.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { SlackAppUninstallService } from '@modules/slack/services/slack-app-uninstall.service';
import { ReportsTabModule } from '@modules/slack/tabs/reports/reports-tab.module';
import { ProjectsTabModule } from '@modules/slack/tabs/projects/projects-tab.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { ProjectOptionsService } from '@modules/slack/services/option-services/project-options.service';
import { ApprovalsTabModule } from '@modules/slack/tabs/approvals/approvals-tab.module';
import { UserOptionsService } from '@modules/slack/services/option-services/user-options.service';
import { TimeTrackingModule } from '@modules/slack/tabs/time-tracking/time-tracking.module';
import { ClientsTabModule } from '@modules/slack/tabs/clients/clients-tab.module';
import { BillingSnapshotsTabModule } from '@modules/slack/tabs/billing-snapshots/billing-snapshots-tab.module';

import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { TeamFileSlackModule } from '@modules/slack/team-file/team-file-slack.module';
import { TeamFileMessagesModule } from '@modules/slack/team-file/team-file-messages.module';
import { TeamFileModule } from 'src/team-file/team-file.module';
import { LeaveFileMessagesModule } from '@modules/slack/leave-file/leave-file-messages.module';
import { LeaveFileModule } from 'src/leave-file/leave-file.module';
import { ReceiptsSlackModule } from '@modules/slack/receipts/receipts-slack.module';
@Module({
  imports: [
    TimeEntriesModule,
    DiscoveryModule,
    UsersModule,
    ApiClientsModule,
    SlackTeamsModule,
    VacationRequestsModule,
    TeamsModule,
    VacationPoliciesModule,
    TeamSetupModule,
    SlackCommunicationModule,
    HolidaysModule,
    ProjectsModule,
    VacationRequestsTabModule,
    HolidaysTabModule,
    VacationPoliciesTabModule,
    ProjectsTabModule,
    TeamsTabModule,
    UsersTabModule,
    HomeTabModule,
    ApprovalsModule,
    SlackCommonModule,
    ReportsTabModule,
    TimeTrackingModule,
    ClientsTabModule,
    BillingSnapshotsTabModule,
    ApprovalsTabModule,
    TeamFileSlackModule,
    TeamFileMessagesModule,
    TeamFileModule,
    LeaveFileMessagesModule,
    LeaveFileModule,
    ReceiptsSlackModule,
  ],
  controllers: [
    SlackOauthController,
    SlackCommandsController,
    SlackInteractionsController,
    SlackEventsController,
    SlackOptionsController,
  ],
  providers: [
    SlackOauthService,
    SlackAppUninstallService,
    VacationCommandService,
    SlackInteractionsService,
    SlackUserAccessService,
    SlackEventsService,
    FileUploadService,
    SlackPayloadParsePipe,
    UserOptionsService,
    ProjectOptionsService,
    SlackHandlersRegistry,
  ],
  exports: [],
})
export class SlackModule {
  public configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SlackPayloadParseMiddleware)
      .forRoutes('api/slack/interactions', 'api/slack/options');
  }
}
