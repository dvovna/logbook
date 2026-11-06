import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';

export interface ITimeEntryViewModel {
  id: string;
  user_id: string;
  project_id: string;
  client_id: string | null;
  team_id: string | null;
  work_date: string;
  minutes: number;
  billable: boolean;
  status: TimeEntryStatus;
  description?: string | null;
  slack_team_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_by: string | null;
  deleted_at: string | null;
  user?: {
    id: string;
    name: string;
    email: string;
    slack_id: string;
  } | null;
  team?: {
    id: string;
    name: string;
  } | null;
  client?: {
    id: string;
    name: string;
  } | null;
  project?: {
    id: string;
    name: string;
  } | null;
}
