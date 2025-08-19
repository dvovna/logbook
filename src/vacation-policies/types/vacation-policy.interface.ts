interface IVacationPolicyViewModel {
  id: string;
  name: string;
  is_primary: boolean;
  slack_team_id: string;
  working_days: number;
  country_code: string | null;
  vacation_days: number;
  bonus_days: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export default IVacationPolicyViewModel;
