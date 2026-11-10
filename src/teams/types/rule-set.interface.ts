import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

export interface IRuleSetViewModel {
  id: string;
  slack_team_id: string;
  name: string | null;
  is_default: boolean;
  hr_approvers: string[];
  hr_approvers_rule: ApprovalRule;
  approval_notification_recipients: string[];
  vacation_policy_id: string | null;
  vacation_policy: { id: string; name: string } | null;
  updated_at: string;
  updated_by: string | null;
}
