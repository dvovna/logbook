import { Module } from '@nestjs/common';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { CreateUserTimeEntryHandler } from '@modules/slack/tabs/time-tracking/handlers/create-user-time-entry.handler';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import UserTimeEntryModalViewValuesParser
  from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';

@Module({
  imports: [
    TimeEntriesModule,
    ProjectsModule,
    SlackCommonModule,
  ],
  providers: [
    TimeEntryFormModalView,
    TimeEntryModalService,
    UserTimeEntryModalViewValuesParser,
    CreateUserTimeEntryHandler,
  ],
  exports: [
    TimeEntryModalService,
  ],
})
export class TimeTrackingModule {}