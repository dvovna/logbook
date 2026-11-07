import { Injectable } from '@nestjs/common';
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
  ) {}

  public async assignEntities(params: IAssignEntitiesParams) {
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
