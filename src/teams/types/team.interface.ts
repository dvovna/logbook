interface ITeamViewModel {
  id: string;
  name: string;
  slack_id: string;
  access_token: string;
  created_at: string | null;
}

export default ITeamViewModel;
