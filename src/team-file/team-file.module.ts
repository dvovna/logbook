import { Module } from '@nestjs/common';
import { TeamsModule } from '@modules/teams/teams.module';
import { UsersModule } from '@modules/users/users.module';
import { NewPersonPromptsRepository } from 'src/team-file/repositories/new-person-prompts.repository';
import { TeamFileUploadsRepository } from 'src/team-file/repositories/team-file-uploads.repository';
import { TeamFileTemplateService } from 'src/team-file/services/team-file-template.service';
import { TeamFileUndoService } from 'src/team-file/services/team-file-undo.service';
import { TeamFileUploadsService } from 'src/team-file/services/team-file-uploads.service';

@Module({
  imports: [UsersModule, TeamsModule],
  providers: [
    TeamFileTemplateService,
    TeamFileUploadsService,
    TeamFileUndoService,
    TeamFileUploadsRepository,
    NewPersonPromptsRepository,
  ],
  exports: [
    TeamFileTemplateService,
    TeamFileUploadsService,
    NewPersonPromptsRepository,
  ],
})
export class TeamFileModule {}
