interface IHolidayViewModel {
  id: string;
  name: string;
  date: string;
  vacation_policy_id: string;
  slack_team_id: string;
  is_company_custom: boolean;
  is_disabled: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export default IHolidayViewModel;
