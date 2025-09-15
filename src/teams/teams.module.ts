import { Module } from '@nestjs/common';
import { TeamsRepository } from 'src/teams/repositories/teams.repository';
import TeamsService from 'src/teams/services/teams.service';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [UsersModule],
  providers: [TeamsRepository, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}
