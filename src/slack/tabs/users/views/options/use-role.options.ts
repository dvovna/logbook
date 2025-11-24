import UserRole from '@common/enums/user-role.enum';
import capitalize from '@common/utils/capitalize';
import { PlainTextOption } from '@slack/web-api';

export const ROLE_OPTIONS = Object.values(UserRole).map<PlainTextOption>(
  (role) => ({
    text: { type: 'plain_text', text: capitalize(role) },
    value: role as UserRole,
  }),
);
