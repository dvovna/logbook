interface ITeamViewModel {
  id: string;
  name: string;
  description: string;
  is_primary: boolean;
  vacation_policy_id: string;
  slack_team_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export default ITeamViewModel;
