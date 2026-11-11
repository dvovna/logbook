import UserRole from '@common/enums/user-role.enum';

export const TEAM_FILE_CANNOT_LEAD_ROLE_LABELS: Partial<
  Record<UserRole, string>
> = {
  [UserRole.HR]: 'HR',
  [UserRole.Finance]: 'Finance',
};
