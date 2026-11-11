import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { TeamFileTemplateService } from 'src/team-file/services/team-file-template.service';

@Module({
  imports: [UsersModule, TeamsModule],
  providers: [TeamFileTemplateService],
  exports: [TeamFileTemplateService],
})
export class TeamFileModule {}
