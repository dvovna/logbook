import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { WorkflowDecisionsService } from '@modules/request-workflows/services/workflow-decisions.service';
import { ApproverAccessService } from '@modules/request-workflows/services/approver-access.service';
import { UsersModule } from '@modules/users/users.module';
import { WorkflowStepProcessorService } from '@modules/request-workflows/services/workflow-step-processor.service';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsRepository } from '@modules/request-workflows/repositories/request-workflow-steps.repository';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { WorkflowStepProcessorsRegistry } from '@modules/request-workflows/workflow-step-processor.registry';
import { TeamsModule } from '@modules/teams/teams.module';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentsRepository } from '@modules/request-workflows/repositories/request-workflow-step-comments.repository';

// The approval workflow itself. Its Slack side (the approver's DM, its
// modals and buttons, the step processor that sends it) is ApprovalsModule
// in src/slack/approvals; step processors are found by discovery.
@Module({
  imports: [DiscoveryModule, TeamsModule, UsersModule],
  providers: [
    RequestWorkflowService,
    WorkflowDecisionsService,
    ApproverAccessService,
    RequestWorkflowStepsRepository,
    RequestWorkflowStepsService,
    WorkflowStepProcessorService,
    RequestWorkflowStepCommentsService,
    RequestWorkflowStepCommentsRepository,
    WorkflowStepProcessorsRegistry,
  ],
  exports: [
    WorkflowDecisionsService,
    RequestWorkflowService,
    RequestWorkflowStepsService,
    RequestWorkflowStepCommentsService,
  ],
})
export class RequestWorkflowsModule {}
