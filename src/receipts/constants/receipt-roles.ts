import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { BILLING_ROLES } from '@common/constants/role-groups';
import { IUserViewModel } from '@modules/users/types/user.interface';

export const RECEIPT_ADMIN_ROLES: readonly UserRole[] = BILLING_ROLES;

export const assertCanManageReceipts = (user: IUserViewModel): void => {
  if (!RECEIPT_ADMIN_ROLES.includes(user.role)) {
    throw new ForbiddenException(
      'Only an admin or finance manages reimbursements.',
    );
  }
};
