import { Module } from '@nestjs/common';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';
import TeamsService from '@modules/teams/services/teams.service';

@Module({
  providers: [TeamsRepository, RuleSetsRepository, TeamsService],
  exports: [TeamsService, RuleSetsRepository],
})
export class TeamsModule {}
