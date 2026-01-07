import { Module } from '@nestjs/common';
import { WorkflowStepProcessorService } from '@modules/request-workflows/services/workflow-step-processor.service';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsRepository } from '@modules/request-workflows/repositories/request-workflow-steps.repository';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { ApproverStepProcessor } from '@modules/request-workflows/step-processors/approver-step.processor';
import { SlackCommunicationModule } from '@modules/slack-communication/slack-communication.module';
import { WorkflowStepProcessorsRegistry } from '@modules/request-workflows/workflow-step-processor.registry';
import { DiscoveryModule } from '@nestjs/core';
import { TeamsModule } from '@modules/teams/teams.module';
import { ApproverStepMessageHandler } from '@modules/request-workflows/handlers/approver-step-message.handler';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentsRepository } from '@modules/request-workflows/repositories/request-workflow-step-comments.repository';
import { ApproverStepCommentModalView } from '@modules/request-workflows/views/approver-step-comment-modal.view';
import { ApproverStepCommentFormSubmitHandler } from '@modules/request-workflows/handlers/approver-step-comment-form-submit.handler';
import CommentModalViewValuesParser from '@modules/request-workflows/parsers/comment-modal-view-values.parser';
import {
  ApproveRequestStepFormSubmitHandler,
} from '@modules/request-workflows/handlers/approve-request-step-form-submit.handler';
import {
  RejectRequestStepFormSubmitHandler,
} from '@modules/request-workflows/handlers/reject-request-step-form-submit.handler';
import { SlackCommonModule } from '@modules/slack/common/slack-common.module';

@Module({
  imports: [DiscoveryModule, SlackCommunicationModule, TeamsModule, SlackCommonModule],
  providers: [
    RequestWorkflowService,
    RequestWorkflowStepsRepository,
    RequestWorkflowStepsService,
    ApproverStepProcessor,
    WorkflowStepProcessorService,
    CommentModalViewValuesParser,
    ApproverStepCommentModalView,
    ApproverStepCommentFormSubmitHandler,
    ApproveRequestStepFormSubmitHandler,
    RejectRequestStepFormSubmitHandler,
    RequestWorkflowStepCommentsService,
    RequestWorkflowStepCommentsRepository,
    WorkflowStepProcessorsRegistry,
    ApproverStepMessageHandler,
  ],
  exports: [
    RequestWorkflowService,
    RequestWorkflowStepsService,
    RequestWorkflowStepCommentsService,
    ApproverStepCommentModalView,
  ],
})
export class RequestWorkflowsModule {}
