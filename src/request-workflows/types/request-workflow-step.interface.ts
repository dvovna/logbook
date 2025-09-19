import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import VacationType from 'src/common/enums/vacation-type.enum';

export enum WorkflowStepType {
  Approver = 'approver',
  Notifier = 'notifier',
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

interface IBaseStepData {
  snapshot: IRequestSnapshotData;
}

export interface IApproverStepData extends IBaseStepData {
  status: 'pending' | 'approved' | 'rejected';
  rule: ApprovalRule;
  decided_at?: string | null;
  comment?: string | null;
}

export interface INotifierStepData extends IBaseStepData {
  notified_at?: string | null;
}

interface IBaseWorkflowStep {
  id: string;
  slack_team_id: string;
  request_id: string;
  slack_user_id: string;
  step_level: number;
  created_at: string;
  updated_at: string;
}

export type IRequestWorkflowStepViewModel =
  | (IBaseWorkflowStep & {
      step_type: WorkflowStepType.Approver;
      step_data: IApproverStepData;
    })
  | (IBaseWorkflowStep & {
      step_type: WorkflowStepType.Notifier;
      step_data: INotifierStepData;
    });
