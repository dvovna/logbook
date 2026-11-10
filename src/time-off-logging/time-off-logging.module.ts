import { Module } from '@nestjs/common';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { UsersModule } from '@modules/users/users.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { VacationRequestsModule } from '@modules/vacation-requests/vacation-requests.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { TimeOffProjectsRepository } from 'src/time-off-logging/repositories/time-off-projects.repository';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';

@Module({
  imports: [
    SlackTeamsModule,
    ProjectsModule,
    UsersModule,
    TeamsModule,
    VacationRequestsModule,
    TimeEntriesModule,
  ],
  providers: [
    TimeOffProjectsRepository,
    TimeOffSettingsService,
    TimeOffLoggingService,
  ],
  exports: [TimeOffSettingsService, TimeOffLoggingService],
})
export class TimeOffLoggingModule {}
