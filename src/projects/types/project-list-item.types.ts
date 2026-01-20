import { ProjectStatus } from 'src/projects/enums/project-status.enum';

export interface IProjectListItem {
  id: string;
  name: string;
  status: ProjectStatus;
  billable: boolean;
  client_name: string | null;
  users_count: number;
  teams: string[];
  description: string;
  updated_at: string;
  created_at: string;
}
