import { Module } from '@nestjs/common';
import { ApprovalsModule } from '@modules/slack/approvals/approvals.module';
import { RequestWorkflowsModule } from '@modules/request-workflows/request-workflows.module';
import { VacationRequestsTabModule } from '@modules/slack/tabs/vacation-requests/vacation-requests-tab.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { UsersModule } from '@modules/users/users.module';
import ApprovalsTabActionHandler from '@modules/slack/tabs/approvals/handlers/approvals-tab-action.handler';
import { RejectTimeEntryFormSubmitHandler } from '@modules/slack/tabs/approvals/handlers/reject-time-entry-form-submit.handler';
import { ApproveAllTimeEntriesFormSubmitHandler } from '@modules/slack/tabs/approvals/handlers/approve-all-time-entries-form-submit.handler';
import { ApprovalsTabService } from '@modules/slack/tabs/approvals/services/approvals-tab.service';
import { TimeEntryNotificationsService } from '@modules/slack/tabs/approvals/services/time-entry-notifications.service';
import { ApprovalsTabView } from '@modules/slack/tabs/approvals/views/approvals-tab.view';

// The Approvals inbox: time off requests and time entries to decide on.
@Module({
  imports: [
    TimeEntriesModule,
    SlackCommonModule,
    UsersModule,
    RequestWorkflowsModule,
    ApprovalsModule,
    VacationRequestsTabModule,
  ],
  providers: [
    ApprovalsTabActionHandler,
    RejectTimeEntryFormSubmitHandler,
    ApproveAllTimeEntriesFormSubmitHandler,
    ApprovalsTabService,
    TimeEntryNotificationsService,
    ApprovalsTabView,
  ],
})
export class ApprovalsTabModule {}
