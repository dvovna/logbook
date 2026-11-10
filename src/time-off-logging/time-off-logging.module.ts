import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { TimeOffProjectsRepository } from 'src/time-off-logging/repositories/time-off-projects.repository';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';

@Module({
  imports: [SlackTeamsModule, ProjectsModule],
  providers: [TimeOffProjectsRepository, TimeOffSettingsService],
  exports: [TimeOffSettingsService],
})
export class TimeOffLoggingModule {}
