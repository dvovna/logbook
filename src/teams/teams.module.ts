import { Module } from '@nestjs/common';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import TeamsService from '@modules/teams/services/teams.service';

@Module({
  providers: [
    TeamsRepository,
    RuleSetsRepository,
    TeamsService,
    TeamRulesService,
    CompanyRulesService,
  ],
  exports: [
    TeamsService,
    RuleSetsRepository,
    TeamRulesService,
    CompanyRulesService,
  ],
})
export class TeamsModule {}
