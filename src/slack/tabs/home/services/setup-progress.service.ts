import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';
import { ISetupProgress } from '@modules/slack/tabs/home/types/setup-progress.interface';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';

// How far the workspace is set up, for the checklist on Admin's and HR's
// Home. Null when the required steps are done, or for other roles.
@Injectable()
export class SetupProgressService {
  public constructor(
    private readonly teamRulesService: TeamRulesService,
    private readonly usersService: UsersService,
    private readonly leaveFileUploadsService: LeaveFileUploadsService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  // `tracksTime`: whether the workspace has a project, archived ones
  // included, which the navigation reads too.
  public async get(
    user: IUserViewModel,
    tracksTime: Promise<boolean>,
  ): Promise<ISetupProgress | null> {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return null;
    }

    const slackTeamId = user.slack_team_id;
    const [rules, peopleWithoutTeam, hasProjects, hasLeaveImport, teamTold] =
      await Promise.all([
        this.teamRulesService.forWorkspace(slackTeamId),
        this.usersService.count({ slackTeamId, withoutTeam: true }),
        tracksTime,
        this.leaveFileUploadsService.hasApplied(slackTeamId),
        this.slackTeamsService.isTeamTold(slackTeamId),
      ]);
    const { companyRules, teams } = rules;
    const progress: ISetupProgress = {
      policyApplies:
        !!companyRules.vacation_policy_id ||
        teams.some(({ vacationPolicyId }) => vacationPolicyId),
      // Saving them is the step, with or without a second approval: a small
      // company may want the team's approval alone. With no teams, "every
      // team has its own rules" is not an answer.
      companyRulesSet:
        !!companyRules.updated_by ||
        (teams.length > 0 && teams.every((team) => !team.followsCompanyRules)),
      hasTeamWithApprovers: teams.some(
        (team) => team.managerApprovers.length || team.hrApprovers.length,
      ),
      companyRulesNameApprovers: companyRules.hr_approvers.length > 0,
      peopleWithoutTeam,
      teamTold,
      hasProjects,
      hasLeaveImport,
    };
    const done =
      progress.policyApplies &&
      progress.companyRulesSet &&
      progress.hasTeamWithApprovers &&
      progress.peopleWithoutTeam === 0 &&
      progress.teamTold;

    return done ? null : progress;
  }
}
