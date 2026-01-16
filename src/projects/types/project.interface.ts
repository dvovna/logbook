interface IProjectViewModel {
  id: string;
  name: string;
  description?: string;
  slack_team_id: string;
  client_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  archived_by?: string | null;
  archived_at?: string | null;
}

export default IProjectViewModel;
