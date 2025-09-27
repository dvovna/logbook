import { MiddlewareConsumer, Module } from '@nestjs/common';
import SlackOauthController from 'src/slack/controllers/slack-oauth.controller';
import SlackOauthService from 'src/slack/services/slack-oauth.service';
import { ClientsModule } from 'src/clients/clients.module';
import { SlackTeamsModule } from 'src/slack-teams/slack-teams.module';
import { UsersModule } from 'src/users/users.module';
import SlackCommandsController from 'src/slack/controllers/slack-commands.controller';
import VacationCommandService from 'src/slack/services/vacation-command.service';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import AdminCommandsController from 'src/slack/controllers/slack-admin-commands.controller';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import SlackInteractionsController from 'src/slack/controllers/slack-interactions.controller';
import SlackInteractionsService from 'src/slack/services/slack-interactions.service';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import { TeamSetupModule } from 'src/team-setup/team-setup.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import SlackEventsController from 'src/slack/controllers/slack-events.controller';
import SlackEventsService from 'src/slack/services/slack-events.service';
import { UserDataImportModule } from 'src/user-data-import/user-data-import.module';
import FileUploadService from 'src/slack/services/file-upload.service';
import { SlackPayloadParsePipe } from 'src/slack/pipes/slack-payload-parse.pipe';
import { SlackPayloadParseMiddleware } from 'src/common/middlewares/slack-payload-parse.middleware';
import { TeamsModule } from 'src/teams/teams.module';
import { SlackHandlersRegistry } from 'src/slack/slack-handlers.registry';
import { DiscoveryModule } from '@nestjs/core';
import { HolidaysModule } from 'src/holidays/holidays.module';
import { SlackOptionsController } from 'src/slack/controllers/slack-options.controller';
import { SlackUserOptionsService } from 'src/slack/services/slack-user-options.service';
import { VacationRequestsTabModule } from 'src/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { HolidaysTabModule } from 'src/slack/tabs/holidays/holidays-tab.module';
import { VacationPoliciesTabModule } from 'src/slack/tabs/vacation-policies/vacation-policies-tab.module';
import { TeamsTabModule } from 'src/slack/tabs/teams/teams-tab.module';
import { UsersTabModule } from 'src/slack/tabs/users/users-tab.module';
import { HomeTabModule } from 'src/slack/tabs/home/home-tab.module';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';
import { SlackAppUninstallService } from 'src/slack/services/slack-app-uninstall.service';

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
