import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import VacationType from '@common/enums/vacation-type.enum';

export enum WorkflowStepType {
  Approver = 'approver',
}

export enum WorkflowStepStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Cancelled = 'canceled',
  Skipped = 'skipped',
}

export interface IRequestSnapshotData {
  user_id: string;
  slack_user_id: string;
  user_name: string;
  user_email: string;
  start_date: string;
  end_date: string;
  days: number;
  working_days: number;
  type: VacationType;
  comment: string;
  // What an approver should know, as of when the request was made.
  context?: IRequestContext;
}

export interface IRequestContext {
  // The requester's balance once this request counts; null without a limit
  // (no vacation policy, or a type without one, such as sick leave).
  balance_after: {
    available: number;
    total: number;
    unit: 'vacation' | 'bonus';
  } | null;
  // Teammates whose approved or pending time off overlaps these dates.
  also_off: { name: string; start_date: string; end_date: string }[];
}

export interface IApproverStepData {
  snapshot: IRequestSnapshotData;
  status: WorkflowStepStatus;
  rule: ApprovalRule;
  // The level's name, e.g. "Manager approval"; missing in older workflows.
  level_name?: string;
  // The run of the workflow (workflow-runs.ts): an edit of a pending request
  // starts a new one. Missing in the first run of older workflows.
  run?: string;
  decided_at?: string | null;
  decided_by_slack_id?: string | null;
  rejection_reason?: string | null;
  // Set when the approver was on time off and the step was skipped.
  skip_reason?: 'time_off';
  // The day the approver is back, the last day of the time off.
  away_until?: string | null;
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
  processed_at?: string;
  // Set when the step was decided or closed.
  completed_at?: string | null;
  step_type: WorkflowStepType.Approver;
  step_data: IApproverStepData;
}
