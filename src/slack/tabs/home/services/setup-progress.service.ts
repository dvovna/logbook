import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ADMIN_AND_HR_ROLES } from '@common/constants/role-groups';

export interface ISetupProgress {
  hasPolicy: boolean;
  hasTeamWithApprovers: boolean;
  // Active people in no team: their requests go to HR or the admins.
  peopleWithoutTeam: number;
  // Optional: only for time tracking.
  hasProjects: boolean;
}

// How far the workspace is set up, for the checklist on Admin's and HR's
// Home. Null when the first three steps are done, or for other roles.
@Injectable()
export class SetupProgressService {
  public constructor(
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
  ) {}

  public async get(user: IUserViewModel): Promise<ISetupProgress | null> {
    if (!ADMIN_AND_HR_ROLES.includes(user.role)) {
      return null;
    }

    const slackTeamId = user.slack_team_id;
    const [policies, teams, peopleWithoutTeam, projects] = await Promise.all([
      this.vacationPoliciesService.search({
        filters: { slackTeamId },
        pageSize: 1,
      }),
      this.teamsService.findMany({ slackTeamId }),
      this.usersService.count({ slackTeamId, withoutTeam: true }),
      this.projectsService.count({ slackTeamId, includeArchived: true }),
    ]);
    const progress: ISetupProgress = {
      hasPolicy: policies.totalCount > 0,
      hasTeamWithApprovers: teams.some(
        (team) =>
          !!team.manager_approvers?.length || !!team.hr_approvers?.length,
      ),
      peopleWithoutTeam,
      hasProjects: projects > 0,
    };
    const done =
      progress.hasPolicy &&
      progress.hasTeamWithApprovers &&
      progress.peopleWithoutTeam === 0;

    return done ? null : progress;
  }
}
