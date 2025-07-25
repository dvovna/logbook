import { Module } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { TeamsRepository } from 'src/teams/teams.repository';

@Module({
  providers: [TeamsService, TeamsRepository],
  exports: [TeamsService, TeamsRepository],
})
export class TeamsModule {}
