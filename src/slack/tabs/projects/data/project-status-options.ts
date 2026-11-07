import { IOption } from '@common/types/option.interface';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { ProjectStatusDisplayNameMap } from 'src/projects/static/project-status-display-name.map';

export const PROJECT_STATUS_OPTIONS: IOption[] = Object.values(
  ProjectStatus,
).map((status) => ({
  id: status,
  name: ProjectStatusDisplayNameMap[status],
}));
