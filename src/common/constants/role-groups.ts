import UserRole from '@common/enums/user-role.enum';

// Role lists that handlers, tabs and guards name explicitly: nothing is open
// to a role unless one of them says so.
export const ALL_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Manager,
  UserRole.Finance,
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

// Rates, amounts, billing reports, snapshots and the uninvoiced report, and
// the clients' projects that carry the rates. HR manages people, not money.
export const BILLING_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.Finance,
];

// Who sees everyone's time in reports and their CSV.
export const COMPANY_TIME_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Finance,
];

// Who sees other people's time in reports: everyone's (COMPANY_TIME_ROLES)
// or a manager's teams'. They get the person filter and "Who hasn't
// submitted".
export const OTHERS_TIME_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Manager,
  UserRole.Finance,
];
