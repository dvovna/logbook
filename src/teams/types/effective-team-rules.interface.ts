import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { IRuleSetViewModel } from '@modules/teams/types/rule-set.interface';

// The rules a person's requests follow: level 1 always comes from the team,
// level 2, the recipients and the policy from the company rules or the team.
export interface IEffectiveTeamRules {
  team: ITeamViewModel | null;
  followsCompanyRules: boolean;
  managerApprovers: string[];
  managerApproversRule: ApprovalRule;
  hrApprovers: string[];
  hrApproversRule: ApprovalRule;
  notificationRecipients: string[];
  vacationPolicyId: string | null;
}

// The company rules and the rules of every team of a workspace.
export interface IWorkspaceTeamRules {
  companyRules: IRuleSetViewModel;
  teams: IEffectiveTeamRules[];
}
