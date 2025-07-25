interface ITeamSettingsViewModel {
  id: string;
  team_id: string;
  vacation_days: number;
  bonus_days: number;
  created_at: string | null;
  created_by: string;
  updated_at: string | null;
  updated_by: string;
}

export default ITeamSettingsViewModel;
