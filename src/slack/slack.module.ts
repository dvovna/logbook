import { MiddlewareConsumer, Module } from '@nestjs/common';
import SlackOauthController from 'src/slack/controllers/slack-oauth.controller';
import SlackOauthService from 'src/slack/services/slack-oauth.service';
import { ClientsModule } from 'src/clients/clients.module';
import { SlackTeamsModule } from 'src/slack-teams/slack-teams.module';
import { UsersModule } from 'src/users/users.module';
import SlackCommandsController from 'src/slack/controllers/slack-commands.controller';
import VacationCommandService from 'src/slack/services/vacation-command.service';
import { VacationsModule } from 'src/vacations/vacations.module';
import AdminCommandsController from 'src/slack/controllers/slack-admin-commands.controller';
import { TeamSettingsModule } from 'src/team-settings/team-settings.module';
import TeamSettingsCommandService from 'src/slack/services/team-settings-command.service';
import SlackInteractionsController from 'src/slack/controllers/slack-interactions.controller';
import SlackInteractionsService from 'src/slack/services/slack-interactions.service';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import { TeamSetupModule } from 'src/team-setup/team-setup.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import SlackEventsController from 'src/slack/controllers/slack-events.controller';
import SlackEventsService from 'src/slack/services/slack-events.service';
import { UserDataImportModule } from 'src/user-data-import/user-data-import.module';
import { SubmitTeamSettingsHandler } from 'src/slack/services/integration-handlers/submit-team-settings.handler';
import { CreateVacationRequestHandler } from 'src/slack/services/integration-handlers/create-vacation-request.handler';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';
import { TeamSettingsViewService } from 'src/slack/services/slack-views/team-settings-view.service';
import FileUploadService from 'src/slack/services/file-upload.service';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { HomeTabViewsService } from 'src/slack/services/slack-views/home-tap-views.service';
import HomeTabActionsHandler from 'src/slack/services/integration-handlers/home-tab-actions.handler';
import { SlackPayloadParsePipe } from 'src/slack/pipes/slack-payload-parse.pipe';
import { SlackPayloadParseMiddleware } from 'src/common/middlewares/slack-payload-parse.middleware';

@Module({
  imports: [
    UsersModule,
    ClientsModule,
    SlackTeamsModule,
    VacationsModule,
    TeamSettingsModule,
    TeamSetupModule,
    SlackCommunicationModule,
    UserDataImportModule,
  ],
  controllers: [
    SlackOauthController,
    SlackCommandsController,
    AdminCommandsController,
    SlackInteractionsController,
    SlackEventsController,
  ],
  providers: [
    SlackOauthService,
    VacationCommandService,
    TeamSettingsCommandService,
    SlackInteractionsService,
    SlackUserAccessService,
    SlackEventsService,
    SubmitTeamSettingsHandler,
    CreateVacationRequestHandler,
    VacationRequestViewService,
    TeamSettingsViewService,
    FileUploadService,
    HomeTabViewsService,
    HomeTabService,
    HomeTabActionsHandler,
    SlackPayloadParsePipe,
  ],
  exports: [],
})
export class SlackModule {
  public configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SlackPayloadParseMiddleware)
      .forRoutes('api/slack/interactions');
  }
}
