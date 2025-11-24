import { Module } from '@nestjs/common';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { VacationRequestsTabService } from '@modules/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { VacationRequestFormModalView } from '@modules/slack/tabs/vacation-requests/views/vacation-request-form-modal.view';
import VacationRequestUserViewValuesParser from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-user-view-values.parser';
import { UserVacationRequestHandler } from '@modules/slack/tabs/vacation-requests/handlers/user-vacation-request.handler';
import { DeleteVacationRequestHandler } from '@modules/slack/tabs/vacation-requests/handlers/delete-vacation-request.handler';
import { TeamsModule } from '@modules/teams/teams.module';
import { AdminVacationRequestHandler } from '@modules/slack/tabs/vacation-requests/handlers/admin-vacation-request.handler';
import VacationRequestsTabActionsHandler from '@modules/slack/tabs/vacation-requests/handlers/vacation-requests-tab-actions.handler';
import { VacationRequestsTabView } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import VacationRequestAdminViewValuesParser from '@modules/slack/tabs/vacation-requests/parsers/vacation-request-admin-view-values.parser';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { UsersModule } from '@modules/users/users.module';
import { VacationHistoryTabService } from '@modules/slack/tabs/vacation-requests/services/vacation-history-tab.service';
import { VacationHistoryTabView } from '@modules/slack/tabs/vacation-requests/views/vacation-history-tab.view';
import VacationHistoryTabActionsHandler from '@modules/slack/tabs/vacation-requests/handlers/vacation-history-tab-actions.handler';
import { RequestWorkflowsModule } from '@modules/request-workflows/request-workflows.module';
import { VacationRequestDetailsModalView } from '@modules/slack/tabs/vacation-requests/views/vacation-request-details-modal.view';
import { VacationDetailsModalService } from '@modules/slack/tabs/vacation-requests/services/vacation-details-modal.service';

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
