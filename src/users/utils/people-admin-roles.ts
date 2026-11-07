import UserRole from '@common/enums/user-role.enum';

// Admin and HR manage everyone's people data and vacations. A manager manages
// only the teams that list them among their manager approvers.
export const PEOPLE_ADMIN_ROLES = [UserRole.Admin, UserRole.HR];

export const isPeopleAdmin = (role: UserRole) =>
  PEOPLE_ADMIN_ROLES.includes(role);
