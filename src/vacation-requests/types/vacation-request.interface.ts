import VacationType from 'src/common/enums/vacation-type.enum';
import VacationStatus from 'src/common/enums/vacation-status.enum';

export interface IVacationRequestViewModel {
  id: string;
  start_date: string;
  end_date: string;
  days: number;
  working_days: number;
  type: VacationType;
  status: VacationStatus;
  comment?: string | null;
  team: {
    id: string;
    name: string;
  } | null;
  user: {
    id: string;
    name: string;
    email: string;
  } | null;
  team_id: string;
  user_id: string;
  slack_team_id: string;
  created_at: string | null;
  updated_at: string | null;
  updated_by: string | null;
  created_by: string | null;
}
