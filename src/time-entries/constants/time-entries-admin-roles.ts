import UserRole from '@common/enums/user-role.enum';

// Roles that see, log, edit and approve everyone's time entries. The others
// work with their own entries; a team's manager also approves its entries.
export const TIME_ENTRIES_ADMIN_ROLES = [UserRole.Admin, UserRole.HR];

export const isTimeEntriesAdmin = (role: UserRole) =>
  TIME_ENTRIES_ADMIN_ROLES.includes(role);
