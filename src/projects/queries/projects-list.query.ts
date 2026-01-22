import { RpcFunctionName } from '@common/enums/rpc-function-name';
import { SupabaseService } from 'src/database/supabase.service';
import { Injectable } from '@nestjs/common';
import {
  IProjectsListData,
  IProjectsListQueryParams,
  IProjectListItemWithTotalCount,
} from 'src/projects/types/projects-list.types';

@Injectable()
export class ProjectsListQuery {
  constructor(private readonly supabase: SupabaseService) {}

  public async execute(params: IProjectsListQueryParams): Promise<IProjectsListData> {
    const {
      slackTeamId,
      page = 1,
      pageSize = 10,
      clientId,
      status,
      billable,
      projectId,
      includeArchived,
    } = params;

    const { data, error } = await this.supabase.getClient().rpc(
      RpcFunctionName.GetProjectsList,
      {
        p_slack_team_id: slackTeamId,
        p_limit: pageSize,
        p_offset: (page - 1) * pageSize,
        p_client_id: clientId,
        p_status: status,
        p_billable: billable,
        p_project_id: projectId,
        p_include_archived: includeArchived,
      },
    );

    if (error) {
      throw new Error(
        `${RpcFunctionName.GetProjectsList} failed: ${error.message}`,
      );
    }

    const items = (data ?? []) as IProjectListItemWithTotalCount[];
    const totalCount = items[0]?.total_count ?? 0;

    return {
      items,
      totalCount,
    };
  }
}
