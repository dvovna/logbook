import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import ProjectsService from 'src/projects/services/projects.service';
import { AssignProjectAssignmentsQuery } from 'src/projects/queries/assign-project-assignments.query';
import { ProjectTeamsRepository } from 'src/projects/repositories/project-teams.repository';
import { ProjectUsersRepository } from 'src/projects/repositories/project-users.repository';
import { IProjectAssignments } from 'src/projects/types/project-assignments.types';

interface IAssignmentParams {
  projectId: string;
  slackTeamId: string;
}

interface IAssignEntitiesParams extends IAssignmentParams {
  teamIds: string[];
  userIds: string[];
}

interface IProjectAssignmentsService {
  assignEntities(params: IAssignEntitiesParams): Promise<void>;
  getAssignments(params: IAssignmentParams): Promise<IProjectAssignments>;
}

@Injectable()
export class ProjectAssignmentsService implements IProjectAssignmentsService {
  constructor(
    private readonly assignProjectAssignmentsQuery: AssignProjectAssignmentsQuery,
    private readonly projectTeamsRepository: ProjectTeamsRepository,
    private readonly projectUsersRepository: ProjectUsersRepository,
    private readonly projectsService: ProjectsService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
  ) {}

  // The IDs come from the form, so the project, teams and people have to be
  // the workspace's: the database function takes them as they are.
  public async assignEntities(params: IAssignEntitiesParams) {
    const { projectId, slackTeamId, teamIds, userIds } = params;

    const [project, teams, users] = await Promise.all([
      this.projectsService.findOne({
        id: projectId,
        slackTeamId,
        includeArchived: true,
      }),
      this.teamsService.findMany({ slackTeamId }),
      userIds.length
        ? this.usersService.findMany({ ids: userIds, slackTeamId })
        : [],
    ]);
    const workspaceTeamIds = new Set(teams.map(({ id }) => id));
    const workspaceUserIds = new Set(users.map(({ id }) => id));

    if (
      !project ||
      !teamIds.every((id) => workspaceTeamIds.has(id)) ||
      !userIds.every((id) => workspaceUserIds.has(id))
    ) {
      throw new ValidationError(
        'Some of the chosen teams or people are not in this workspace.',
      );
    }

    return this.assignProjectAssignmentsQuery.execute(params);
  }

  public async getAssignments({ projectId, slackTeamId }: IAssignmentParams) {
    const assignmentsQuery = {
      project_id: projectId,
      slack_team_id: slackTeamId,
    };

    const [teams, users] = await Promise.all([
      this.projectTeamsRepository.findMany(assignmentsQuery),
      this.projectUsersRepository.findMany(assignmentsQuery),
    ]);

    return {
      teamIds: teams.map(({ team_id }) => team_id),
      userIds: users.map(({ user_id }) => user_id),
    };
  }
}
