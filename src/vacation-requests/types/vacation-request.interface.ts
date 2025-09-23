import VacationType from 'src/common/enums/vacation-type.enum';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';

export interface IVacationRequestViewModel {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  working_days: number;
  type: VacationType;
  status: VacationRequestStatus;
  user_comment?: string | null;
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
  team_id: string;
  user_id: string;
  slack_team_id: string;
  created_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  created_by: string | null;
}
