import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { RATE_ROLES } from 'src/projects/constants/rate-roles';

// Who creates billing snapshots, sends their CSV, marks them invoiced and
// sees the uninvoiced report: those who see rates and amounts, Admin and Finance.
export const SNAPSHOT_ROLES = RATE_ROLES;

// Who unlocks a snapshot, which deletes it: an admin.
export const UNLOCK_SNAPSHOT_ROLES: readonly UserRole[] = [UserRole.Admin];

export const canManageSnapshots = (role: UserRole) =>
  SNAPSHOT_ROLES.includes(role);

export const canUnlockSnapshots = (role: UserRole) =>
  UNLOCK_SNAPSHOT_ROLES.includes(role);

export const assertCanManageSnapshots = ({ role }: { role: UserRole }) => {
  if (!canManageSnapshots(role)) {
    throw new ForbiddenException(
      'Only Admin and Finance work with billing snapshots.',
    );
  }
};

export const assertCanUnlockSnapshots = ({ role }: { role: UserRole }) => {
  if (!canUnlockSnapshots(role)) {
    throw new ForbiddenException('Only an admin unlocks billing snapshots.');
  }
};
