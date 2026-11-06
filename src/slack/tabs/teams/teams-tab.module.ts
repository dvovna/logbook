import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { DeleteTeamFormSubmitHandler } from '@modules/slack/tabs/teams/handlers/delete-team-form-submit.handler';
import { TeamFormSubmitHandler } from '@modules/slack/tabs/teams/handlers/team-form-submit.handler';
import TeamsTabActionHandler from '@modules/slack/tabs/teams/handlers/teams-tab-action.handler';
import { TeamsTabService } from '@modules/slack/tabs/teams/services/teams-tab.service';
import TeamModalViewValuesParser from '@modules/slack/tabs/teams/parsers/team-modal-view-values.parser';
import { TeamsTabView } from '@modules/slack/tabs/teams/views/teams-tab.view';
import { TeamModalView } from '@modules/slack/tabs/teams/views/team-modal.view';
import { UsersModule } from '@modules/users/users.module';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';

@Module({
  imports: [
    TeamsModule,
    UsersModule,
    VacationPoliciesModule,
    SlackCommonModule,
  ],
  providers: [
    DeleteTeamFormSubmitHandler,
    TeamFormSubmitHandler,
    TeamsTabActionHandler,
    TeamModalViewValuesParser,
    TeamsTabService,
    TeamsTabView,
    TeamModalView,
  ],
  exports: [TeamsTabService],
})
export class TeamsTabModule {}
