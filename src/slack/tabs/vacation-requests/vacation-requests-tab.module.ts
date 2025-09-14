import { Module } from '@nestjs/common';
import { VacationRequestsModule } from 'src/vacation-requests/vacation-requests.module';
import { VacationRequestsTabService } from 'src/slack/tabs/vacation-requests/services/vacation-requests-tab.service';
import { VacationRequestModalView } from 'src/slack/tabs/vacation-requests/views/vacation-request-modal.view';
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

@Module({
  imports: [
    VacationRequestsModule,
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
    VacationRequestModalView,
    VacationRequestAdminViewValuesParser,
    VacationRequestUserViewValuesParser,
  ],
  exports: [
    VacationRequestsTabService,
    VacationRequestModalView,
    VacationHistoryTabView,
    VacationHistoryTabService,
  ],
})
export class VacationRequestsTabModule {}
