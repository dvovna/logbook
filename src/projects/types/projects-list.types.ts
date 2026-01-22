import { IProjectListItem } from 'src/projects/types/project-list-item.types';

export interface IProjectsListQueryParams {
  slackTeamId: string;
  page?: number;
  pageSize?: number;
  clientId?: string;
  status?: string;
  billable?: boolean;
  projectId?: string;
  includeArchived?: boolean;
}

interface ITotalCount {
  total_count: number;
}

export type IProjectListItemWithTotalCount = IProjectListItem & ITotalCount;

export interface IProjectsListData {
  items: IProjectListItemWithTotalCount[];
  totalCount: number;
}
