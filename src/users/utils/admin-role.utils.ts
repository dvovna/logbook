import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';

interface IUserChange {
  role?: UserRole;
  isActive?: boolean;
}

// HR manages people, but only an admin makes someone an admin, takes the role
// away or deactivates an admin. Otherwise HR could make themselves admin.
export const assertCanChangeUser = (
  actor: IUserViewModel,
  target: IUserViewModel,
  change: IUserChange,
) => {
  if (actor.role === UserRole.Admin) {
    return;
  }

  const grantsAdmin =
    change.role === UserRole.Admin && target.role !== UserRole.Admin;
  const changesAnAdmin =
    target.role === UserRole.Admin &&
    ((change.role !== undefined && change.role !== UserRole.Admin) ||
      change.isActive !== undefined);

  if (grantsAdmin || changesAnAdmin) {
    throw new ForbiddenException(
      'Only an admin can grant or remove the Admin role, or deactivate an admin.',
    );
  }
};
