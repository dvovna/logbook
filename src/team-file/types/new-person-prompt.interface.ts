export interface INewPersonPrompt {
  id: string;
  slack_team_id: string;
  user_id: string;
  recipient_slack_id: string;
  channel: string;
  ts: string;
  closed_at: string | null;
  created_at: string;
}
