import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ISetupProgress } from '@modules/slack/tabs/home/types/setup-progress.interface';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';

// How far the workspace is set up, for the checklist on Admin's and HR's
// Home. Null when the four required steps are done, or for other roles.
@Injectable()
export class SetupProgressService {
  public constructor(
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly teamRulesService: TeamRulesService,
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
  ) {}

  public async get(user: IUserViewModel): Promise<ISetupProgress | null> {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return null;
    }

    const slackTeamId = user.slack_team_id;
    const [policies, rules, peopleWithoutTeam, projects] = await Promise.all([
      this.vacationPoliciesService.search({
        filters: { slackTeamId },
        pageSize: 1,
      }),
      this.teamRulesService.forWorkspace(slackTeamId),
      this.usersService.count({ slackTeamId, withoutTeam: true }),
      this.projectsService.count({ slackTeamId, includeArchived: true }),
    ]);
    const progress: ISetupProgress = {
      hasPolicy: policies.totalCount > 0,
      // With no teams, "every team has its own rules" is not an answer.
      hasCompanyApprovers:
        rules.companyRules.hr_approvers.length > 0 ||
        (rules.teams.length > 0 &&
          rules.teams.every((team) => !team.followsCompanyRules)),
      hasTeamWithApprovers: rules.teams.some(
        (team) => team.managerApprovers.length || team.hrApprovers.length,
      ),
      companyRulesNameApprovers: rules.companyRules.hr_approvers.length > 0,
      peopleWithoutTeam,
      hasProjects: projects > 0,
    };
    const done =
      progress.hasPolicy &&
      progress.hasCompanyApprovers &&
      progress.hasTeamWithApprovers &&
      progress.peopleWithoutTeam === 0;

    return done ? null : progress;
  }
}
