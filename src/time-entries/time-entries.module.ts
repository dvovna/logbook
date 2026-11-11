import { Module } from '@nestjs/common';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { TimeEntriesSummaryService } from 'src/time-entries/services/time-entries-summary.service';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { ProjectsModule } from 'src/projects/projects.module';
import { TeamsModule } from '@modules/teams/teams.module';
import { ClientsModule } from '@modules/clients/clients.module';
import { BillingReportService } from 'src/time-entries/services/billing-report.service';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { UsersModule } from '@modules/users/users.module';
import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';
import { TimeReportService } from 'src/time-entries/services/time-report.service';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';
import { TimesheetWeekService } from 'src/time-entries/services/timesheet-week.service';
import { TimesheetSaveService } from 'src/time-entries/services/timesheet-save.service';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';

@Module({
  imports: [
    ProjectsModule,
    TeamsModule,
    ClientsModule,
    SlackTeamsModule,
    UsersModule,
  ],
  providers: [
    TimeEntriesRepository,
    TimeEntriesService,
    TimeEntryWriter,
    TimeEntriesValidationService,
    TimeEntryApprovalsService,
    TimeEntriesSummaryService,
    BillingReportService,
    TimeEntriesListQuery,
    TimeEntriesScopeService,
    TimeReportService,
    TimeEntriesExportService,
    TimesheetWeekService,
    TimesheetSaveService,
  ],
  exports: [
    TimeEntriesSummaryService,
    BillingReportService,
    TimeEntriesService,
    TimeEntryWriter,
    TimeEntryApprovalsService,
    TimeEntriesListQuery,
    TimeReportService,
    TimeEntriesExportService,
    TimeEntriesScopeService,
    TimesheetWeekService,
    TimesheetSaveService,
  ],
})
export class TimeEntriesModule {}
