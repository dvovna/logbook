import { Module } from '@nestjs/common';
import { WorkflowStepProcessorService } from 'src/request-workflows/services/workflow-step-processor.service';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsRepository } from 'src/request-workflows/repositories/request-workflow-steps.repository';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { ApproverStepProcessor } from 'src/request-workflows/step-handlers/approver-step.processor';
import { NotifierStepProcessor } from 'src/request-workflows/step-handlers/notifier-step.processor';
import { SlackCommunicationModule } from 'src/slack-communication/slack-communication.module';
import { WorkflowStepProcessorsRegistry } from 'src/request-workflows/workflow-step-processor.registry';
import { DiscoveryModule } from '@nestjs/core';
import { TeamsModule } from 'src/teams/teams.module';

@Module({
  imports: [DiscoveryModule, SlackCommunicationModule, TeamsModule],
  providers: [
    RequestWorkflowService,
    RequestWorkflowStepsRepository,
    RequestWorkflowStepsService,
    ApproverStepProcessor,
    NotifierStepProcessor,
    WorkflowStepProcessorService,
    WorkflowStepProcessorsRegistry,
  ],
  exports: [RequestWorkflowService],
})
export class RequestWorkflowsModule {}
