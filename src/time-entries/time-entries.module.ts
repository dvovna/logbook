import { Module } from '@nestjs/common';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { ProjectsModule } from 'src/projects/projects.module';
import { TeamsModule } from '@modules/teams/teams.module';

@Module({
  imports: [ProjectsModule, TeamsModule],
  providers: [
    TimeEntriesRepository,
    TimeEntriesService,
    TimeEntriesValidationService,
    TimeEntryApprovalsService,
    TimeEntriesSummaryService,
    TimeEntriesListQuery,
  ],
  exports: [
    TimeEntriesSummaryService,
    TimeEntriesService,
    TimeEntryApprovalsService,
    TimeEntriesListQuery,
  ],
})
export class TimeEntriesModule {}
