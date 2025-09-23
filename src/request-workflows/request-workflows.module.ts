import { Module } from '@nestjs/common';
import { WorkflowStepProcessorService } from 'src/request-workflows/services/workflow-step-processor.service';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsRepository } from 'src/request-workflows/repositories/request-workflow-steps.repository';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { ApproverStepProcessor } from 'src/request-workflows/step-processors/approver-step.processor';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { WorkflowStepProcessorsRegistry } from 'src/request-workflows/workflow-step-processor.registry';
import { DiscoveryModule } from '@nestjs/core';
import { TeamsModule } from 'src/teams/teams.module';
import { ApproverStepMessageHandler } from 'src/request-workflows/handlers/approver-step-message.handler';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentsRepository } from 'src/request-workflows/repositories/request-workflow-step-comments.repository';
import { ApproverStepCommentModalView } from 'src/request-workflows/views/approver-step-comment-modal.view';
import { ApproverStepCommentFormSubmitHandler } from 'src/request-workflows/handlers/approver-step-comment-form-submit.handler';
import CommentModalViewValuesParser from 'src/request-workflows/parsers/comment-modal-view-values.parser';

@Module({
  imports: [DiscoveryModule, SlackCommunicationModule, TeamsModule],
  providers: [
    RequestWorkflowService,
    RequestWorkflowStepsRepository,
    RequestWorkflowStepsService,
    ApproverStepProcessor,
    WorkflowStepProcessorService,
    CommentModalViewValuesParser,
    ApproverStepCommentModalView,
    ApproverStepCommentFormSubmitHandler,
    RequestWorkflowStepCommentsService,
    RequestWorkflowStepCommentsRepository,
    WorkflowStepProcessorsRegistry,
    ApproverStepMessageHandler,
  ],
  exports: [
    RequestWorkflowService,
    RequestWorkflowStepsService,
    RequestWorkflowStepCommentsService,
  ],
})
export class RequestWorkflowsModule {}
