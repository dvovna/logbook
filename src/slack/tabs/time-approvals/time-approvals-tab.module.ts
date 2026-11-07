import { Module } from '@nestjs/common';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { UsersModule } from '@modules/users/users.module';
import TimeApprovalsTabActionHandler from '@modules/slack/tabs/time-approvals/handlers/time-approvals-tab-action.handler';
import { RejectTimeEntryFormSubmitHandler } from '@modules/slack/tabs/time-approvals/handlers/reject-time-entry-form-submit.handler';
import { ApproveAllTimeEntriesFormSubmitHandler } from '@modules/slack/tabs/time-approvals/handlers/approve-all-time-entries-form-submit.handler';
import { TimeApprovalsTabService } from '@modules/slack/tabs/time-approvals/services/time-approvals-tab.service';
import { TimeEntryNotificationsService } from '@modules/slack/tabs/time-approvals/services/time-entry-notifications.service';
import { TimeApprovalsTabView } from '@modules/slack/tabs/time-approvals/views/time-approvals-tab.view';

@Module({
  imports: [TimeEntriesModule, SlackCommonModule, UsersModule],
  providers: [
    TimeApprovalsTabActionHandler,
    RejectTimeEntryFormSubmitHandler,
    ApproveAllTimeEntriesFormSubmitHandler,
    TimeApprovalsTabService,
    TimeEntryNotificationsService,
    TimeApprovalsTabView,
  ],
})
export class TimeApprovalsTabModule {}
