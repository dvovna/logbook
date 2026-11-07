import UserRole from '@common/enums/user-role.enum';

// Role lists that handlers, tabs and guards name explicitly: nothing is open
// to a role unless one of them says so.
export const ALL_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Manager,
  UserRole.Member,
];

export const MANAGER_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Manager,
];

export const ADMIN_AND_HR_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.HR,
];
