import { IRequestWorkflowStepViewModel } from '@modules/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

export interface IWorkflowStepProcessor {
  supports(step: IRequestWorkflowStepViewModel): boolean;
  processPending(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): Promise<void>;
  updateMessage(
    step: IRequestWorkflowStepViewModel,
    comments: IWorkflowStepCommentViewModel[],
    // The request is deleted: the step in the database no longer exists, so
    // its stored status is that of a cancellation.
    requestDeleted?: boolean,
  ): Promise<void>;
}
