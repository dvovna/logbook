import { Module } from '@nestjs/common';
import { TeamsRepository } from 'src/teams/repositories/teams.repository';
import TeamsService from 'src/teams/services/teams.service';

@Module({
  providers: [TeamsRepository, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
