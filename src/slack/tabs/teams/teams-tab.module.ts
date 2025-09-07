import { Module } from '@nestjs/common';
import { TeamsModule } from 'src/teams/teams.module';
import { DeleteTeamFormSubmitHandler } from 'src/slack/tabs/teams/handlers/delete-team-form-submit.handler';
import { TeamFormSubmitHandler } from 'src/slack/tabs/teams/handlers/team-form-submit.handler';
import TeamsTabActionHandler from 'src/slack/tabs/teams/handlers/teams-tab-action.handler';
import { TeamsTabService } from 'src/slack/tabs/teams/services/teams-tab.service';
import TeamModalViewValuesParser from 'src/slack/tabs/teams/parsers/team-modal-view-values.parser';
import { TeamsTabView } from 'src/slack/tabs/teams/views/teams-tab.view';
import { TeamModalView } from 'src/slack/tabs/teams/views/team-modal.view';
import { UsersModule } from 'src/users/users.module';
import { VacationPoliciesModule } from 'src/vacation-policies/vacation-policies.module';
import { SlackCommonModule } from 'src/slack/common/slack-common.module';

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
