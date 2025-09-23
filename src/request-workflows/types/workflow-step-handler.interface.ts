import { IRequestWorkflowStepViewModel } from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';

export interface IWorkflowStepProcessor {
  supports(step: IRequestWorkflowStepViewModel): boolean;
  process(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
  complete(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
  updateMessage(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
}
