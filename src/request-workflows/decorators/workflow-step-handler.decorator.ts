import { SetMetadata } from '@nestjs/common';
import { WorkflowStepType } from '@modules/request-workflows/types/request-workflow-step.interface';

export const WORKFLOW_STEP_PROCESSOR = 'WORKFLOW_STEP_PROCESSOR';

export const WorkflowStepProcessor = (type: WorkflowStepType) =>
  SetMetadata(WORKFLOW_STEP_PROCESSOR, type);
