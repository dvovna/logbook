export interface ILeaveBalance {
  id: string;
  slack_team_id: string;
  user_id: string;
  balance_on: string;
  days_left: number | null;
  working_days_left: number | null;
  bonus_days_left: number | null;
  upload_id: string | null;
  set_by: string | null;
  created_at: string;
  updated_at: string;
}
