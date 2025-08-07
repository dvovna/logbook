import { Module } from '@nestjs/common';
import SlackOauthController from 'src/slack/controllers/slack-oauth.controller';
import SlackOauthService from 'src/slack/services/slack-oauth.service';
import { ClientsModule } from 'src/clients/clients.module';
import { TeamsModule } from 'src/teams/teams.module';
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

@Module({
  imports: [
    UsersModule,
    ClientsModule,
    TeamsModule,
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
  ],
  exports: [],
})
export class SlackModule {}
