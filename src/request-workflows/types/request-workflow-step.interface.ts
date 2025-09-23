import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import VacationType from 'src/common/enums/vacation-type.enum';

export enum WorkflowStepType {
  Approver = 'approver',
}

export interface IRequestSnapshotData {
  user_id: string;
  user_name: string;
  user_email: string;
  start_date: string;
  end_date: string;
  days: number;
  working_days: number;
  type: VacationType;
  comment: string;
}

export interface IApproverStepData {
  snapshot: IRequestSnapshotData;
  status: 'pending' | 'approved' | 'rejected';
  rule: ApprovalRule;
  decided_at?: string | null;
  decided_by_slack_id?: string | null;
}

export interface IRequestWorkflowStepViewModel {
  id: string;
  slack_team_id: string;
  request_id: string;
  slack_user_id: string;
  slack_message_ts?: string | null;
  slack_channel_id?: string | null;
  step_level: number;
  created_at: string;
  updated_at: string;
  step_type: WorkflowStepType.Approver;
  step_data: IApproverStepData;
}
