import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { callFunction } from 'src/database/sql-functions';

export interface IUserProject {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
}

@Injectable()
export class GetUserProjectsQuery {
  constructor(private readonly database: DatabaseService) {}

  public async execute(params: {
    userId: string;
    slackTeamId: string;
    includeArchived?: boolean;
  }): Promise<IUserProject[]> {
    const { userId, slackTeamId, includeArchived = false } = params;

    const rows = await callFunction(this.database.db, 'get_user_projects', {
      p_user_id: userId,
      p_slack_team_id: slackTeamId,
      p_include_archived: includeArchived,
    });

    return rows.map((row) => ({
      id: row.project_id,
      name: row.project_name,
      clientId: row.client_id,
      clientName: row.client_name,
    }));
  }
}
