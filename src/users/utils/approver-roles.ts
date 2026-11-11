import UserRole from '@common/enums/user-role.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';

// Who can decide a time off approval step: an active person with a role
// whose approval buttons work (ApproverStepMessageHandler).
export const canApprove = (user: { is_active: boolean; role: UserRole }) =>
  user.is_active && MANAGER_ROLES.includes(user.role);
