import VacationType from '@common/enums/vacation-type.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

export interface IVacationRequestViewModel {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  working_days: number;
  type: VacationType;
  status: VacationRequestStatus;
  user_comment?: string | null;
  rejection_reason?: string | null;
  team: {
    id: string;
    name: string;
    slack_id: string;
  } | null;
  user: {
    id: string;
    name: string;
    email: string;
    slack_id: string;
  } | null;
  team_id: string | null;
  user_id: string;
  slack_team_id: string;
  created_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  created_by: string | null;
  leave_file_upload_id: string | null;
  // Pending with nobody who could decide it when its approval started: it
  // starts once someone can (VacationRequestProcessingService).
  awaits_approvers?: boolean;
}
