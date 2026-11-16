import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { todayIso } from '@common/utils/period-presets';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

// What its requester may cancel: a request waiting for approval, or approved
// time off before its first day (UTC, as the app runs).
export const isCancelable = (
  request: Pick<IVacationRequestViewModel, 'status' | 'start_date'>,
  today = todayIso(),
) =>
  request.status === VacationRequestStatus.Pending ||
  (request.status === VacationRequestStatus.Approved &&
    request.start_date > today);
