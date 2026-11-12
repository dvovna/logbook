import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

// Whether an edit by HR or an admin approves or rejects the request: a
// decision, which people hear of as they do of the workflow's, its offer to
// log the time off as time included.
export const decidesRequest = (
  previous: IVacationRequestViewModel,
  current: IVacationRequestViewModel,
) =>
  current.status !== previous.status &&
  (current.status === VacationRequestStatus.Approved ||
    current.status === VacationRequestStatus.Rejected);
