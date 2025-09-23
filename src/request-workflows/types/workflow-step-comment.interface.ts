export interface IWorkflowStepCommentViewModel {
  id: string;
  request_id: string;
  slack_team_id: string;
  slack_user_id: string;
  step_id: string;
  created_by: string;
  comment: string;
  step_level: number;
  created_at: string;
}
