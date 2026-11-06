import { RpcFunctionName } from '@common/enums/rpc-function-name';
import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/database/supabase.service';

export interface IUserProject {
  id: string;
  name: string;
  clientId: string;
  clientName: string;
}

@Injectable()
export class GetUserProjectsQuery {
  constructor(private readonly supabase: SupabaseService) {}

  public async execute(params: {
    userId: string;
    slackTeamId: string;
    includeArchived?: boolean;
  }): Promise<IUserProject[]> {
    const { userId, slackTeamId, includeArchived = false } = params;

    const { data, error } = await this.supabase.getClient().rpc(
      RpcFunctionName.GetUserProjects,
      {
        p_user_id: userId,
        p_slack_team_id: slackTeamId,
        p_include_archived: includeArchived,
      },
    );

    if (error) {
      throw new Error(
        `${RpcFunctionName.GetUserProjects} failed: ${error.message}`,
      );
    }

    return (data || []).map((row) => ({
      id: row.project_id,
      name: row.project_name,
      clientId: row.client_id,
      clientName: row.client_name,
    }));
  }
}
