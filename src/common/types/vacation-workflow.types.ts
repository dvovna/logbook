import { RequestWorkflowStatus } from 'src/common/enums/request-workflow-status.enum';

export interface IVacationWorkflow {
  requestId: string;
  status: RequestWorkflowStatus;
  slackTeamId: string;
  approvedBy: string;
}
