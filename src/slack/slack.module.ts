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
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import SlackInteractionsController from 'src/slack/controllers/slack-interactions.controller';
import SlackInteractionsService from 'src/slack/services/slack-interactions.service';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import { TeamSetupModule } from 'src/team-setup/team-setup.module';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import SlackEventsController from 'src/slack/controllers/slack-events.controller';
import SlackEventsService from 'src/slack/services/slack-events.service';
import { UserDataImportModule } from 'src/user-data-import/user-data-import.module';
import { CreateVacationRequestHandler } from 'src/slack/services/integration-handlers/create-vacation-request.handler';
import { VacationRequestModalViewService } from 'src/slack/services/slack-views/modal-views/vacation-request-modal-view.service';
import { VacationPolicyModalViewService } from 'src/slack/services/slack-views/modal-views/vacation-policy-modal-view.service';
import FileUploadService from 'src/slack/services/file-upload.service';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { HomeTabViewsService } from 'src/slack/services/slack-views/tab-views/home-tap-view.service';
import HomeTabActionsHandler from 'src/slack/services/integration-handlers/home-tab-actions.handler';
import { SlackPayloadParsePipe } from 'src/slack/pipes/slack-payload-parse.pipe';
import { SlackPayloadParseMiddleware } from 'src/common/middlewares/slack-payload-parse.middleware';
import { TeamsTabViewService } from 'src/slack/services/slack-views/tab-views/teams-tab-view.service';
import { TeamsModule } from 'src/teams/teams.module';
import { TeamsTabService } from 'src/slack/services/teams-tab.service';
import TeamActionsHandler from 'src/slack/services/integration-handlers/team-actions.handler';
import { TeamModalViewService } from 'src/slack/services/slack-views/modal-views/team-modal-view.service';
import { TeamFormSubmitHandler } from 'src/slack/services/integration-handlers/team-form-submit.handler';
import TeamModalViewValuesParser from 'src/slack/services/slack-views/parsers/team-modal-view-values.parser';
import VacationRequestViewValuesParser from 'src/slack/services/slack-views/parsers/vacation-request-view-values.parser';
import { VacationPoliciesTabService } from 'src/slack/services/vacation-policies-tab.service';
import { VacationPolicyManagementTabViewService } from 'src/slack/services/slack-views/tab-views/vacation-policy-management-tab-view.service';
import DeleteTeamModalViewService from 'src/slack/services/slack-views/modal-views/delete-team-modal-view.service';
import { DeleteTeamFormSubmitHandler } from 'src/slack/services/integration-handlers/delete-team-form-submit.handler';
import { UsersTabViewService } from 'src/slack/services/slack-views/tab-views/users-tab-view.service';
import { UsersTabService } from 'src/slack/services/users-tab.service';
import UserActionsHandler from 'src/slack/services/integration-handlers/user-actions.handler';
import { EditUserModalViewService } from 'src/slack/services/slack-views/modal-views/edit-user-modal-view.service';
import { EditUserFormSubmitHandler } from 'src/slack/services/integration-handlers/edit-user-form-submit.handler';
import EditUserModalViewValuesParser from 'src/slack/services/slack-views/parsers/edit-user-modal-view-values.parser';
import ChangeUserStatusModalViewService from 'src/slack/services/slack-views/modal-views/change-user_status-modal-view.service';
import { ChangeUserStatusFormSubmitHandler } from 'src/slack/services/integration-handlers/change-user-status-form-submit.handler';

@Module({
  imports: [
    UsersModule,
    ClientsModule,
    SlackTeamsModule,
    VacationsModule,
    TeamsModule,
    VacationPoliciesModule,
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
    SlackInteractionsService,
    SlackUserAccessService,
    SlackEventsService,
    CreateVacationRequestHandler,
    VacationRequestModalViewService,
    TeamsTabViewService,
    UsersTabViewService,
    VacationPolicyModalViewService,
    EditUserModalViewService,
    UsersTabService,
    FileUploadService,
    HomeTabViewsService,
    HomeTabService,
    HomeTabActionsHandler,
    SlackPayloadParsePipe,
    TeamActionsHandler,
    UserActionsHandler,
    TeamsTabService,
    TeamModalViewService,
    TeamModalViewValuesParser,
    VacationRequestViewValuesParser,
    TeamFormSubmitHandler,
    VacationPolicyManagementTabViewService,
    VacationPoliciesTabService,
    DeleteTeamModalViewService,
    DeleteTeamFormSubmitHandler,
    ChangeUserStatusFormSubmitHandler,
    EditUserModalViewValuesParser,
    EditUserFormSubmitHandler,
    ChangeUserStatusModalViewService,
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
