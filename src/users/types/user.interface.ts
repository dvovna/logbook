import UserRole from '@common/enums/user-role.enum';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';

export interface IUserViewModel {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  is_active: boolean;
  contract_start_date?: string | null;
  carryover_days?: number | null;
  team_id: string | null;
  slack_team_id: string;
  slack_id: string;
  created_at: string;
  time_reminder: TimeReminder;
}
