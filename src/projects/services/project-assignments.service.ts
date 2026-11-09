import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import ProjectsService from 'src/projects/services/projects.service';
import { TransactionService } from 'src/database/transaction.service';
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
    private readonly transactions: TransactionService,
    private readonly projectTeamsRepository: ProjectTeamsRepository,
    private readonly projectUsersRepository: ProjectUsersRepository,
    private readonly projectsService: ProjectsService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
  ) {}

  // The IDs come from the form, so the project, teams and people have to be
  // the workspace's. Then the project's teams and people become these, in one
  // transaction.
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

    const link = { slack_team_id: slackTeamId, project_id: projectId };

    await this.transactions.transaction(async () => {
      await this.projectTeamsRepository.deleteMany(link);
      await this.projectTeamsRepository.createMany(
        teamIds.map((team_id) => ({ ...link, team_id })),
      );
      await this.projectUsersRepository.deleteMany(link);
      await this.projectUsersRepository.createMany(
        userIds.map((user_id) => ({ ...link, user_id })),
      );
    });
  }

  // The active people assigned to each of these projects, by name.
  public async findPeopleByProject(projectIds: string[], slackTeamId: string) {
    const assignments = await this.projectUsersRepository.findMany({
      project_id: { operator: 'in', value: projectIds },
      slack_team_id: slackTeamId,
    });
    const people = await this.usersService.findMany({
      ids: [...new Set(assignments.map(({ user_id }) => user_id))],
      slackTeamId,
    });
    const nameOf = new Map(people.map(({ id, name }) => [id, name]));
    const byProject: Record<string, string[]> = {};

    for (const { project_id, user_id } of assignments) {
      const name = nameOf.get(user_id);

      if (name) {
        (byProject[project_id] ??= []).push(name);
      }
    }

    for (const names of Object.values(byProject)) {
      names.sort((a, b) => a.localeCompare(b));
    }

    return byProject;
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
