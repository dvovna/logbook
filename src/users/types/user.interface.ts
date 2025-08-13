import UserRole from 'src/common/enums/user-role.enum';

export interface IUserViewModel {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  contract_start_date?: string | null;
  team_id: string;
  slack_team_id: string;
  slack_id: string;
  created_at: string;
}
