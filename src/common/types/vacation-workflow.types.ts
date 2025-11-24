import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

export interface IVacationWorkflow {
  requestId: string;
  status: RequestWorkflowStatus;
  slackTeamId: string;
  approvedBy: string;
  reviewComments: IWorkflowStepCommentViewModel[];
}
