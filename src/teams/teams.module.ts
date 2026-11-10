import { Module } from '@nestjs/common';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import TeamsService from '@modules/teams/services/teams.service';

@Module({
  providers: [TeamsRepository, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
