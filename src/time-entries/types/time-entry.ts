import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';

export interface ITimeEntryViewModel {
  id: string;
  user_id: string;
  project_id: string;
  client_id: string | null;
  team_id: string | null;
  work_date: string;
  minutes: number;
  status: TimeEntryStatus;
  description?: string | null;
  slack_team_id: string;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  deleted_by: string | null;
  deleted_at: string | null;
}