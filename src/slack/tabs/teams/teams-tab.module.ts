import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { DeleteTeamFormSubmitHandler } from '@modules/slack/tabs/teams/handlers/delete-team-form-submit.handler';
import { CompanyRulesFormSubmitHandler } from '@modules/slack/tabs/teams/handlers/company-rules-form-submit.handler';
import { TeamFormRulesHandler } from '@modules/slack/tabs/teams/handlers/team-form-rules.handler';
import CompanyRulesViewValuesParser from '@modules/slack/tabs/teams/parsers/company-rules-view-values.parser';
import { CompanyRulesModalView } from '@modules/slack/tabs/teams/views/company-rules-modal.view';
import { TeamFormSubmitHandler } from '@modules/slack/tabs/teams/handlers/team-form-submit.handler';
import TeamsTabActionHandler from '@modules/slack/tabs/teams/handlers/teams-tab-action.handler';
import { RuleInputsValidationService } from '@modules/slack/tabs/teams/services/rule-inputs-validation.service';
import { TeamsTabService } from '@modules/slack/tabs/teams/services/teams-tab.service';
import TeamModalViewValuesParser from '@modules/slack/tabs/teams/parsers/team-modal-view-values.parser';
import { TeamsTabView } from '@modules/slack/tabs/teams/views/teams-tab.view';
import { TeamModalView } from '@modules/slack/tabs/teams/views/team-modal.view';
import { UsersModule } from '@modules/users/users.module';
import { VacationPoliciesModule } from '@modules/vacation-policies/vacation-policies.module';
import { TeamFileSlackModule } from '@modules/slack/team-file/team-file-slack.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';

@Module({
  imports: [
    TeamsModule,
    UsersModule,
    VacationPoliciesModule,
    SlackCommonModule,
    TeamFileSlackModule,
  ],
  providers: [
    CompanyRulesFormSubmitHandler,
    CompanyRulesModalView,
    CompanyRulesViewValuesParser,
    DeleteTeamFormSubmitHandler,
    TeamFormRulesHandler,
    TeamFormSubmitHandler,
    TeamsTabActionHandler,
    TeamModalViewValuesParser,
    RuleInputsValidationService,
    TeamsTabService,
    TeamsTabView,
    TeamModalView,
  ],
  exports: [TeamsTabService],
})
export class TeamsTabModule {}
