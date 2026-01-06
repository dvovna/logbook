import { MiddlewareConsumer, Module } from '@nestjs/common';
import SlackOauthController from '@modules/slack/controllers/slack-oauth.controller';
import SlackOauthService from '@modules/slack/services/slack-oauth.service';
import { ClientsModule } from '@modules/clients/clients.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { UsersModule } from '@modules/users/users.module';
import SlackCommandsController from '@modules/slack/controllers/slack-commands.controller';
import VacationCommandService from '@modules/slack/services/vacation-command.service';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import AdminCommandsController from '@modules/slack/controllers/slack-admin-commands.controller';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import SlackInteractionsController from '@modules/slack/controllers/slack-interactions.controller';
import SlackInteractionsService from '@modules/slack/services/slack-interactions.service';
import SlackUserAccessService from '@modules/slack/services/slack-user-access.service';
import { TeamSetupModule } from '@modules/team-setup/team-setup.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import SlackEventsController from '@modules/slack/controllers/slack-events.controller';
import SlackEventsService from '@modules/slack/services/slack-events.service';
import { UserDataImportModule } from '@modules/user-data-import/user-data-import.module';
import FileUploadService from '@modules/slack/services/file-upload.service';
import { SlackPayloadParsePipe } from '@modules/slack/pipes/slack-payload-parse.pipe';
import { SlackPayloadParseMiddleware } from '@common/middlewares/slack-payload-parse.middleware';
import { TeamsModule } from '@modules/teams/teams.module';
import { SlackHandlersRegistry } from '@modules/slack/slack-handlers.registry';
import { DiscoveryModule } from '@nestjs/core';
import { HolidaysModule } from '@modules/holidays/holidays.module';
import { SlackOptionsController } from '@modules/slack/controllers/slack-options.controller';
import { SlackUserOptionsService } from '@modules/slack/services/slack-user-options.service';
import { VacationRequestsTabModule } from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { HolidaysTabModule } from '@modules/slack/tabs/holidays/holidays-tab.module';
import { VacationPoliciesTabModule } from '@modules/slack/tabs/vacation-policies/vacation-policies-tab.module';
import { TeamsTabModule } from '@modules/slack/tabs/teams/teams-tab.module';
import { UsersTabModule } from '@modules/slack/tabs/users/users-tab.module';
import { HomeTabModule } from '@modules/slack/tabs/home/home-tab.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { SlackAppUninstallService } from '@modules/slack/services/slack-app-uninstall.service';
import { PeopleTabModule } from '@modules/slack/tabs/people/people-tab.module';

@Module({
  imports: [
    DiscoveryModule,
    UsersModule,
    ClientsModule,
    SlackTeamsModule,
    VacationRequestsModule,
    TeamsModule,
    VacationPoliciesModule,
    TeamSetupModule,
    SlackCommunicationModule,
    UserDataImportModule,
    HolidaysModule,
    VacationRequestsTabModule,
    HolidaysTabModule,
    VacationPoliciesTabModule,
    TeamsTabModule,
    UsersTabModule,
    HomeTabModule,
    SlackCommonModule,
    PeopleTabModule,
  ],
  controllers: [
    SlackOauthController,
    SlackCommandsController,
    AdminCommandsController,
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
    SlackUserOptionsService,
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
