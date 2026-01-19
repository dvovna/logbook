import { ProjectStatus } from 'src/projects/enums/project-status.enum';

export const ProjectStatusDisplayNameMap = {
  [ProjectStatus.Active]: 'Active',
  [ProjectStatus.OnHold]: 'On hold',
  [ProjectStatus.Completed]: 'Completed',
};
