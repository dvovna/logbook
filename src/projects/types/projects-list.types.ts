import { IProjectListItem } from 'src/projects/types/project-list-item.types';
import { ITotalCount } from '@common/types/list.types';

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

export type IProjectListItemWithTotalCount = IProjectListItem & ITotalCount;

export interface IProjectsListData {
  items: IProjectListItem[];
  totalCount: number;
}
