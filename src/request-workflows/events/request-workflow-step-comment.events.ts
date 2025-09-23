import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';

export class RequestWorkflowStepCommentAddedEvent {
  public constructor(public readonly comment: IWorkflowStepCommentViewModel) {}
}
