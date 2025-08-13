import { Module } from '@nestjs/common';
import { TeamsRepository } from 'src/teams/teams.repository';
import TeamsService from 'src/teams/teams.service';

@Module({
  providers: [TeamsRepository, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
