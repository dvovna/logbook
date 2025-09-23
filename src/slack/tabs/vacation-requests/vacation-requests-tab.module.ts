import { Module } from '@nestjs/common';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { VacationRequestsTabService } from 'src/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { VacationRequestFormModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import VacationRequestUserViewValuesParser from 'src/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';
import { UserVacationRequestHandler } from 'src/slack/tabs/vacation-requests/handlers/user-vacation-request.handler';
import { DeleteVacationRequestHandler } from 'src/slack/tabs/vacation-requests/handlers/delete-vacation-request.handler';
import { TeamsModule } from 'src/teams/teams.module';
import { AdminVacationRequestHandler } from 'src/slack/tabs/vacation-requests/handlers/admin-vacation-request.handler';
import VacationRequestsTabActionsHandler from 'src/slack/tabs/vacation-requests/handlers/vacation-requests-tab-actions.handler';
import { VacationRequestsTabView } from 'src/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import VacationRequestAdminViewValuesParser from 'src/slack/tabs/vacation-requests/parsers/vacation-request-admin-view-values.parser';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';
import { UsersModule } from 'src/users/users.module';
import { VacationHistoryTabService } from 'src/slack/tabs/vacation-requests/services/vacation-history-tab.service';
import { VacationHistoryTabView } from 'src/slack/tabs/vacation-requests/views/vacation-history-tab.view';
import VacationHistoryTabActionsHandler from 'src/slack/tabs/vacation-requests/handlers/vacation-history-tab-actions.handler';
import { RequestWorkflowsModule } from 'src/request-workflows/request-workflows.module';
import {
  VacationRequestDetailsModalView
} from 'src/slack/tabs/vacation-requests/views/vacation-request-details-modal.view';
import { VacationDetailsModalService } from 'src/slack/tabs/vacation-requests/services/vacation-details-modal.service';

@Module({
  imports: [
    VacationRequestsModule,
    RequestWorkflowsModule,
    TeamsModule,
    SlackCommonModule,
    UsersModule,
  ],
  providers: [
    VacationRequestsTabService,
    AdminVacationRequestHandler,
    UserVacationRequestHandler,
    VacationRequestsTabActionsHandler,
    VacationHistoryTabActionsHandler,
    VacationHistoryTabService,
    VacationHistoryTabView,
    DeleteVacationRequestHandler,
    VacationRequestsTabView,
    VacationRequestFormModalView,
    VacationRequestDetailsModalView,
    VacationDetailsModalService,
    VacationRequestAdminViewValuesParser,
    VacationRequestUserViewValuesParser,
  ],
  exports: [
    VacationRequestsTabService,
    VacationHistoryTabView,
    VacationHistoryTabService,
    VacationDetailsModalService,
    VacationRequestDetailsModalView,
    VacationRequestFormModalView,
  ],
})
export class VacationRequestsTabModule {}
