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
import { TimeEntryRemindersService } from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { TimesheetFormModalView } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';
import { TimesheetFormSubmitHandler } from '@modules/slack/tabs/time-tracking/handlers/timesheet-form-submit.handler';
import { TimesheetFormActionHandler } from '@modules/slack/tabs/time-tracking/handlers/timesheet-form-action.handler';

@Module({
  imports: [
    TimeEntriesModule,
    ProjectsModule,
    SlackCommonModule,
    UsersModule,
    ClientsModule,
    SlackTeamsModule,
    SlackCommunicationModule,
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
    TimeEntryRemindersService,
    TimesheetFormModalView,
    TimesheetFormSubmitHandler,
    TimesheetFormActionHandler,
  ],
  exports: [TimeEntryModalService],
})
export class TimeTrackingModule {}
