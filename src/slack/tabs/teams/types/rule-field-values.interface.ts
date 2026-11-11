import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';

// What the rule fields (level 2, who hears of decisions, the policy) show.
export interface IRuleFieldValues {
  vacationPolicyId: string | null;
  hrApprovers: string[];
  hrApproversRule: ApprovalRule;
  notificationRecipients: string[];
}
