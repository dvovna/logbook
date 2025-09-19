import { Injectable } from '@nestjs/common';
import { WorkflowStepProcessorsRegistry } from 'src/request-workflows/workflow-step-processor.registry';
import { IRequestWorkflowStepViewModel } from 'src/request-workflows/types/request-workflow-step.interface';

@Injectable()
export class WorkflowStepProcessorService {
  public constructor(
    private readonly registry: WorkflowStepProcessorsRegistry,
  ) {}

  public async activateSteps(steps: IRequestWorkflowStepViewModel[]) {
    for (const step of steps) {
      const handler = this.registry.getHandler(step.step_type);

      if (!handler) {
        throw new Error(`No handler found for step type: ${step.step_type}`);
      }

      await handler.process(step);
    }
  }
}
