import UserRole from '@common/enums/user-role.enum';
import { IOption } from '@common/types/option.interface';

export const ROLE_DISPLAY_NAME: Record<UserRole, string> = {
  [UserRole.Admin]: 'Admin',
  [UserRole.HR]: 'HR',
  [UserRole.Manager]: 'Manager',
  [UserRole.Member]: 'Member',
};

// From the most rights to the fewest.
export const ROLE_OPTIONS: IOption[] = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Manager,
  UserRole.Member,
].map((role) => ({ name: ROLE_DISPLAY_NAME[role], id: role }));
