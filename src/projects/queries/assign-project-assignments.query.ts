import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { callFunction } from 'src/database/sql-functions';

export interface IAssignProjectTeamsQueryParams {
  slackTeamId: string;
  projectId: string;
  teamIds: string[];
  userIds: string[];
}

@Injectable()
export class AssignProjectAssignmentsQuery {
  constructor(private readonly database: DatabaseService) {}

  public async execute(params: IAssignProjectTeamsQueryParams): Promise<void> {
    const { slackTeamId, projectId, teamIds, userIds } = params;

    await callFunction(this.database.db, 'assign_project_assignments', {
      p_slack_team_id: slackTeamId,
      p_project_id: projectId,
      p_team_ids: teamIds,
      p_user_ids: userIds,
    });
  }
}
