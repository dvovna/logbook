import { IRequestWorkflowStepViewModel } from '@modules/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

export interface IWorkflowStepProcessor {
  supports(step: IRequestWorkflowStepViewModel): boolean;
  processPending(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
  processCompleted(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
  processCanceled(step: IRequestWorkflowStepViewModel): Promise<void>;
  updateMessage(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
}
