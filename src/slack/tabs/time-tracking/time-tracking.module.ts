import { Module } from '@nestjs/common';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { CreateUserTimeEntryHandler } from '@modules/slack/tabs/time-tracking/handlers/create-user-time-entry.handler';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import UserTimeEntryModalViewValuesParser
  from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import TimeEntriesTabActionHandler from '@modules/slack/tabs/time-tracking/handlers/time-entries-tab-action.handler';
import { TimeEntriesTabDataService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab-data.service';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { TimeEntriesTabView } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';

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
    TimeEntriesListQuery,
    TimeEntriesTabDataService,
    TimeEntriesTabService,
    TimeEntriesTabView,
    TimeEntriesTabActionHandler,
  ],
  exports: [
    TimeEntryModalService,
  ],
})
export class TimeTrackingModule {}