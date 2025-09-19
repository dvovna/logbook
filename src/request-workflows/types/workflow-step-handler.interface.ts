import { IRequestWorkflowStepViewModel } from 'src/request-workflows/types/request-workflow-step.interface';

export interface IWorkflowStepProcessor {
  supports(step: IRequestWorkflowStepViewModel): boolean;
  process(step: IRequestWorkflowStepViewModel): Promise<void>;
}
