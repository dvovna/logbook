import { Injectable, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';
import { IWorkflowStepProcessor } from 'src/request-workflows/types/workflow-step-handler.interface';
import { WorkflowStepType } from 'src/request-workflows/types/request-workflow-step.interface';
import { WORKFLOW_STEP_PROCESSOR } from 'src/request-workflows/decorators/workflow-step-handler.decorator';

@Injectable()
export class WorkflowStepProcessorsRegistry implements OnModuleInit {
  private processors = new Map<WorkflowStepType, IWorkflowStepProcessor>();

  public constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  public onModuleInit() {
    const providers = this.discovery.getProviders();

    for (const wrapper of providers) {
      const { instance } = wrapper;

      if (!instance) {
        continue;
      }

      const stepType = this.reflector.get<WorkflowStepType>(
        WORKFLOW_STEP_PROCESSOR,
        instance.constructor,
      );

      if (stepType) {
        this.processors.set(stepType, instance as IWorkflowStepProcessor);
      }
    }
  }

  public getHandler(
    type: WorkflowStepType,
  ): IWorkflowStepProcessor | undefined {
    return this.processors.get(type);
  }
}
