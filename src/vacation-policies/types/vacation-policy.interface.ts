interface IVacationPolicyViewModel {
  id: string;
  name: string;
  slack_team_id: string;
  working_days: number;
  vacation_days: number;
  carryover_days: number;
  bonus_days: number;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export default IVacationPolicyViewModel;
