import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { VacationsTabService } from '@modules/slack/tabs/vacations/services/vacations-tab.service';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import VacationsTabActionHandler from '@modules/slack/tabs/vacations/handlers/vacations-tab-action.handler';
import { VacationsTabView } from '@modules/slack/tabs/vacations/views/vacations-tab.view';
import { VacationRequestsTabModule } from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { RequestWorkflowsModule } from '@modules/request-workflows/request-workflows.module';
import { TeamsModule } from '@modules/teams/teams.module';

@Module({
  imports: [
    SlackCommonModule,
    VacationRequestsModule,
    VacationRequestsTabModule,
    RequestWorkflowsModule,
    TeamsModule,
  ],
  providers: [VacationsTabActionHandler, VacationsTabService, VacationsTabView],
  exports: [VacationsTabService],
})
export class VacationsTabModule {}
