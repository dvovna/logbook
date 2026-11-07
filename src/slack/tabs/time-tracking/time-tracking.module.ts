import { Module } from '@nestjs/common';
import { TimeEntryFormModalView } from '@modules/slack/tabs/time-tracking/views/time-entry-form-modal.view';
import { TimeEntryModalService } from '@modules/slack/tabs/time-tracking/services/time-entry-modal.service';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ProjectsModule } from 'src/projects/projects.module';
import { UserTimeEntryFormSubmitHandler } from '@modules/slack/tabs/time-tracking/handlers/user-time-entry-form-submit.handler';
import { AdminTimeEntryFormSubmitHandler } from '@modules/slack/tabs/time-tracking/handlers/admin-time-entry-form-submit.handler';
import AdminTimeEntryModalViewValuesParser from '@modules/slack/tabs/time-tracking/parsers/admin-time-entry-modal-view-values.parser';
import { UsersModule } from '@modules/users/users.module';
import { ClientsModule } from '@modules/clients/clients.module';
import { DeleteTimeEntryFormSubmitHandler } from '@modules/slack/tabs/time-tracking/handlers/delete-time-entry-form-submit.handler';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import UserTimeEntryModalViewValuesParser from '@modules/slack/tabs/time-tracking/parsers/user-time-entry-modal-view-values.parser';
import { TimeEntriesTabService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab.service';
import TimeEntriesTabActionHandler from '@modules/slack/tabs/time-tracking/handlers/time-entries-tab-action.handler';
import { TimeEntriesTabDataService } from '@modules/slack/tabs/time-tracking/services/time-entries-tab-data.service';
import { TimeEntriesTabView } from '@modules/slack/tabs/time-tracking/views/time-entries-tab.view';

@Module({
  imports: [
    TimeEntriesModule,
    ProjectsModule,
    SlackCommonModule,
    UsersModule,
    ClientsModule,
  ],
  providers: [
    TimeEntryFormModalView,
    TimeEntryModalService,
    UserTimeEntryModalViewValuesParser,
    AdminTimeEntryModalViewValuesParser,
    UserTimeEntryFormSubmitHandler,
    AdminTimeEntryFormSubmitHandler,
    DeleteTimeEntryFormSubmitHandler,
    TimeEntriesTabDataService,
    TimeEntriesTabService,
    TimeEntriesTabView,
    TimeEntriesTabActionHandler,
  ],
  exports: [TimeEntryModalService],
})
export class TimeTrackingModule {}
