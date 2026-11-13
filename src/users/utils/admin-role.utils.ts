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
// Takes the roles alone, so that a view can ask before it offers a choice.
export const canChangeUser = (
  actorRole: UserRole,
  targetRole: UserRole,
  change: IUserChange,
) => {
  if (actorRole === UserRole.Admin) {
    return true;
  }

  const changesRole = change.role !== undefined && change.role !== targetRole;
  const grantsOrRemoves =
    changesRole &&
    (ADMIN_GRANTED_ROLES.includes(change.role!) ||
      ADMIN_GRANTED_ROLES.includes(targetRole));
  const deactivatesAnAdmin =
    targetRole === UserRole.Admin && change.isActive !== undefined;

  return !grantsOrRemoves && !deactivatesAnAdmin;
};

export const assertCanChangeUser = (
  actor: IUserViewModel,
  target: IUserViewModel,
  change: IUserChange,
) => {
  if (!canChangeUser(actor.role, target.role, change)) {
    throw new ForbiddenException(
      'Only an admin can grant or remove the Admin or Finance role, or deactivate an admin.',
    );
  }
};
