import { Module } from '@nestjs/common';
import { RequestWorkflowsModule } from '@modules/request-workflows/request-workflows.module';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';
import { UsersModule } from '@modules/users/users.module';
import { SlackTeamsModule } from '@modules/slack-teams/slack-teams.module';
import { TimeEntriesModule } from 'src/time-entries/time-entries.module';
import { ApproverRemindersService } from '@modules/slack/approvals/services/approver-reminders.service';
import { RejectStepModalView } from '@modules/slack/approvals/views/reject-step-modal.view';
import { ApproverStepProcessor } from '@modules/slack/approvals/step-processors/approver-step.processor';
import { ApproverStepMessageHandler } from '@modules/slack/approvals/handlers/approver-step-message.handler';
import { ApproverStepCommentModalView } from '@modules/slack/approvals/views/approver-step-comment-modal.view';
import { ApproverStepCommentFormSubmitHandler } from '@modules/slack/approvals/handlers/approver-step-comment-form-submit.handler';
import CommentModalViewValuesParser from '@modules/slack/approvals/parsers/comment-modal-view-values.parser';
import { ApproveRequestStepFormSubmitHandler } from '@modules/slack/approvals/handlers/approve-request-step-form-submit.handler';
import { RejectRequestStepFormSubmitHandler } from '@modules/slack/approvals/handlers/reject-request-step-form-submit.handler';

// The Slack side of approvals: the approver's DM with its buttons, the
// comment, approve and reject forms, the step processor that sends and
// updates the DM, and the approvers' reminders.
@Module({
  imports: [
    RequestWorkflowsModule,
    SlackCommunicationModule,
    SlackCommonModule,
    UsersModule,
    SlackTeamsModule,
    TimeEntriesModule,
  ],
  providers: [
    RejectStepModalView,
    ApproverStepProcessor,
    CommentModalViewValuesParser,
    ApproverStepCommentModalView,
    ApproverStepCommentFormSubmitHandler,
    ApproveRequestStepFormSubmitHandler,
    RejectRequestStepFormSubmitHandler,
    ApproverStepMessageHandler,
    ApproverRemindersService,
  ],
  exports: [RejectStepModalView, ApproverStepCommentModalView],
})
export class ApprovalsModule {}
