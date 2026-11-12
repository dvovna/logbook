import { Injectable } from '@nestjs/common';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import {
  IEffectiveTeamRules,
  IWorkspaceTeamRules,
} from '@modules/teams/types/effective-team-rules.interface';
import ITeamViewModel from '@modules/teams/types/team.interface';
import { CompanyRuleValues } from '@modules/teams/types/rule-set.interface';

@Injectable()
export class TeamRulesService {
  public constructor(
    private readonly teamsRepository: TeamsRepository,
    private readonly ruleSetsRepository: RuleSetsRepository,
  ) {}

  // Also for a person in no team, or a team ID that is not the workspace's.
  public async forTeam(
    teamId: string | null | undefined,
    slackTeamId: string,
  ): Promise<IEffectiveTeamRules> {
    const found = teamId
      ? await this.teamsRepository.findOneWithCompanyRules(teamId, slackTeamId)
      : null;

    if (found && !found.team.rule_set_id) {
      return ownRules(found.team);
    }

    return ruleSetRules(
      found?.team ?? null,
      found?.companyRules ??
        (await this.ruleSetsRepository.ensureDefault(slackTeamId)),
    );
  }

  // The company rules and the rules of every team, read together.
  public async forWorkspace(slackTeamId: string): Promise<IWorkspaceTeamRules> {
    const [teams, companyRules] = await Promise.all([
      this.teamsRepository.findMany({ slack_team_id: slackTeamId }),
      this.ruleSetsRepository.ensureDefault(slackTeamId),
    ]);

    return {
      companyRules,
      teams: teams.map((team) =>
        team.rule_set_id ? ruleSetRules(team, companyRules) : ownRules(team),
      ),
    };
  }
}

const ownRules = (team: ITeamViewModel): IEffectiveTeamRules => ({
  team,
  followsCompanyRules: false,
  managerApprovers: team.manager_approvers ?? [],
  managerApproversRule: team.manager_approvers_rule,
  hrApprovers: team.hr_approvers ?? [],
  hrApproversRule: team.hr_approvers_rule,
  notificationRecipients: team.approval_notification_recipients ?? [],
  vacationPolicyId: team.vacation_policy_id,
});

// Level 1 always comes from the team.
const ruleSetRules = (
  team: ITeamViewModel | null,
  ruleSet: CompanyRuleValues,
): IEffectiveTeamRules => ({
  team,
  followsCompanyRules: true,
  managerApprovers: team?.manager_approvers ?? [],
  managerApproversRule: team?.manager_approvers_rule ?? ApprovalRule.Any,
  hrApprovers: ruleSet.hr_approvers,
  hrApproversRule: ruleSet.hr_approvers_rule,
  notificationRecipients: ruleSet.approval_notification_recipients,
  vacationPolicyId: ruleSet.vacation_policy_id,
});
