import { DatabaseService } from 'src/database/database.service';
import { callFunction } from 'src/database/sql-functions';
import { Injectable } from '@nestjs/common';
import {
  IProjectsListData,
  IProjectsListQueryParams,
  IProjectListItemWithTotalCount,
} from 'src/projects/types/projects-list.types';

const DEFAULT_PROJECTS_PAGE_SIZE = 5;

@Injectable()
export class ProjectsListQuery {
  constructor(private readonly database: DatabaseService) {}

  public async execute(
    params: IProjectsListQueryParams,
  ): Promise<IProjectsListData> {
    const {
      slackTeamId,
      page = 1,
      pageSize = DEFAULT_PROJECTS_PAGE_SIZE,
      clientId,
      status,
      billable,
      projectId,
      includeArchived,
    } = params;

    const rows = await callFunction(this.database.db, 'get_projects_list', {
      p_slack_team_id: slackTeamId,
      p_limit: pageSize,
      p_offset: (page - 1) * pageSize,
      p_client_id: clientId,
      p_status: status,
      p_billable: billable,
      p_project_id: projectId,
      p_include_archived: includeArchived,
    });

    const items = rows as IProjectListItemWithTotalCount[];
    const totalCount = items[0]?.total_count ?? 0;

    return {
      items,
      totalCount,
    };
  }
}
