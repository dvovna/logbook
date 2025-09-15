import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';

interface ITeamViewModel {
  id: string;
  name: string;
  description: string;
  is_primary: boolean;
  vacation_policy_id: string;
  manager_approvers: string[] | null;
  hr_approvers: string[] | null;
  approval_notification_recipients: string[] | null;
  manager_approvers_rule: ApprovalRule | null;
  hr_approvers_rule: ApprovalRule | null;
  slack_team_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export default ITeamViewModel;
