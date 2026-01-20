import { Injectable } from '@nestjs/common';
import { SupabaseService } from 'src/database/supabase.service';
import { RpcFunctionName } from '@common/enums/rpc-function-name';

export interface IAssignProjectTeamsQueryParams {
  slackTeamId: string;
  projectId: string;
  teamIds: string[];
  userIds: string[];
}

@Injectable()
export class AssignProjectAssignmentsQuery {
  constructor(private readonly supabase: SupabaseService) {}

  public async execute(params: IAssignProjectTeamsQueryParams): Promise<void> {
    const { slackTeamId, projectId, teamIds, userIds } = params;

    const { error } = await this.supabase.getClient().rpc(
      RpcFunctionName.AssignProjectAssignments,
      {
        p_slack_team_id: slackTeamId,
        p_project_id: projectId,
        p_team_ids: teamIds,
        p_user_ids: userIds,
      },
    );

    if (error) {
      throw new Error(`${RpcFunctionName.AssignProjectAssignments} failed: ${error.message}`);
    }
  }
}
