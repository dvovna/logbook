import { Injectable } from '@nestjs/common';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import { RuleSetsRepository } from '@modules/teams/repositories/rule-sets.repository';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { IEffectiveTeamRules } from '@modules/teams/types/effective-team-rules.interface';

@Injectable()
export class TeamRulesService {
  public constructor(
    private readonly teamsRepository: TeamsRepository,
    private readonly ruleSetsRepository: RuleSetsRepository,
  ) {}

  // The rules for a team, or for a person in no team (also a team ID that is
  // not the workspace's).
  public async forTeam(
    teamId: string | null | undefined,
    slackTeamId: string,
  ): Promise<IEffectiveTeamRules> {
    const team = teamId
      ? await this.teamsRepository.findOne({
          id: teamId,
          slack_team_id: slackTeamId,
        })
      : null;

    if (team && !team.rule_set_id) {
      return {
        team,
        followsCompanyRules: false,
        managerApprovers: team.manager_approvers ?? [],
        managerApproversRule: team.manager_approvers_rule,
        hrApprovers: team.hr_approvers ?? [],
        hrApproversRule: team.hr_approvers_rule,
        notificationRecipients: team.approval_notification_recipients ?? [],
        vacationPolicyId: team.vacation_policy_id,
      };
    }

    const ruleSet = await this.ruleSetsRepository.ensureDefault(slackTeamId);

    return {
      team,
      followsCompanyRules: true,
      managerApprovers: team?.manager_approvers ?? [],
      managerApproversRule: team?.manager_approvers_rule ?? ApprovalRule.Any,
      hrApprovers: ruleSet.hr_approvers,
      hrApproversRule: ruleSet.hr_approvers_rule,
      notificationRecipients: ruleSet.approval_notification_recipients,
      vacationPolicyId: ruleSet.vacation_policy_id,
    };
  }
}
