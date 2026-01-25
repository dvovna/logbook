import UserRole from '@common/enums/user-role.enum';
import capitalize from '@common/utils/capitalize';
import { IOption } from '@modules/slack/common/types/option.interface';

export const ROLE_OPTIONS = Object.values(UserRole).map<IOption>(
  (role) => ({
    name: capitalize(role),
    id: role as UserRole,
  }),
);
