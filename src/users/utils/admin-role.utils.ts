import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';

interface IUserChange {
  role?: UserRole;
  isActive?: boolean;
}

// The roles only an admin grants or takes away: Admin, and Finance, which
// sees rates and money that HR doesn't.
const ADMIN_GRANTED_ROLES: readonly UserRole[] = [
  UserRole.Admin,
  UserRole.Finance,
];

// HR manages people, but only an admin makes someone an admin or Finance,
// takes either role away or deactivates an admin. Otherwise HR could make
// themselves admin, or someone Finance to see the rates.
export const assertCanChangeUser = (
  actor: IUserViewModel,
  target: IUserViewModel,
  change: IUserChange,
) => {
  if (actor.role === UserRole.Admin) {
    return;
  }

  const changesRole = change.role !== undefined && change.role !== target.role;
  const grantsOrRemoves =
    changesRole &&
    (ADMIN_GRANTED_ROLES.includes(change.role!) ||
      ADMIN_GRANTED_ROLES.includes(target.role));
  const deactivatesAnAdmin =
    target.role === UserRole.Admin && change.isActive !== undefined;

  if (grantsOrRemoves || deactivatesAnAdmin) {
    throw new ForbiddenException(
      'Only an admin can grant or remove the Admin or Finance role, or deactivate an admin.',
    );
  }
};
