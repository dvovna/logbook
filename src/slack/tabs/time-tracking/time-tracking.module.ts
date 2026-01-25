import { Module } from '@nestjs/common';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ProjectsModule } from 'src/projects/projects.module';

@Module({
  imports: [
    TimeEntriesModule,
    ProjectsModule,
  ],
  providers: [
    TimeEntryFormModalView,
    TimeEntryModalService,
  ],
  exports: [
    TimeEntryModalService,
  ],
})
export class TimeTrackingModule {}