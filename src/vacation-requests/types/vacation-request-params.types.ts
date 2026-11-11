import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

export interface IVacationRequestCreateParams {
  userId: string;
  teamId: string | null;
  startDate: Date;
  endDate: Date;
  type: VacationType;
  status: VacationRequestStatus;
  userComment?: string | null;
}

export interface IVacationRequestUpdateParams {
  startDate?: Date;
  endDate?: Date;
  type?: VacationType;
  status?: VacationRequestStatus;
  userComment?: string | null;
  // The request's person; the request goes to their team.
  userId?: string;
}

export interface IVacationRequestFindParams {
  id?: string;
  userId?: string;
  userIds?: string[];
  teamId?: string;
  teamIds?: string[];
  year?: string;
  startDate?: string;
  // Requests that share at least one day with this period.
  overlapping?: { startDate: string; endDate: string };
  statuses?: VacationRequestStatus[];
  type?: VacationType;
  slackTeamId: string;
}

// An edit that passed VacationRequestsService.checkUpdate, for applyUpdate.
export interface IVacationRequestUpdate {
  // The request as the checks read it.
  checked: IVacationRequestViewModel;
  changes: IVacationRequestUpdateParams;
  // The team of the request's new person, when the edit names one.
  teamId?: string | null;
  days: number;
  workingDays: number;
}
