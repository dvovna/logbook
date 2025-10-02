import { Injectable } from '@nestjs/common';
import { WorkflowStepProcessorsRegistry } from 'src/request-workflows/workflow-step-processor.registry';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';

@Injectable()
export class WorkflowStepProcessorService {
  public constructor(
    private readonly registry: WorkflowStepProcessorsRegistry,
  ) {}

  public async processSteps(
    steps: IRequestWorkflowStepViewModel[],
    comments: IWorkflowStepCommentViewModel[],
  ) {
    for (const step of steps) {
      const handler = this.getHandler(step.step_type);

      await handler.processPending(step, comments);
    }
  }

  public async completeSteps(
    steps: IRequestWorkflowStepViewModel[],
    comments: IWorkflowStepCommentViewModel[],
  ) {
    for (const step of steps) {
      const handler = this.getHandler(step.step_type);

      await handler.processCompleted(step, comments);
    }
  }

  public async updateStepMessages(
    steps: IRequestWorkflowStepViewModel[],
    comments: IWorkflowStepCommentViewModel[] = [],
  ): Promise<void> {
    for (const step of steps) {
      const handler = this.getHandler(step.step_type);

      await handler.updateMessage(step, comments);
    }
  }

  private getHandler(stepType: WorkflowStepType) {
    const handler = this.registry.getHandler(stepType);

    if (!handler) {
      throw new Error(`No handler found for step type: ${stepType}`);
    }

    return handler;
  }
}
