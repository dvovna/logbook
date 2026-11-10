import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

// Whether an edit changes what a vacation's logged time was made of: whose it
// is, its days, its leave type (which names the project) or its status. Its
// logged time is then removed, and logged again only from a new offer, so a
// vacation never has two sets of entries.
export const changesLoggedTime = (
  previous: IVacationRequestViewModel,
  current: IVacationRequestViewModel,
) =>
  previous.user_id !== current.user_id ||
  previous.start_date !== current.start_date ||
  previous.end_date !== current.end_date ||
  previous.type !== current.type ||
  previous.status !== current.status;

// The lock that logging a vacation as time and changing the vacation both
// take, so neither works on what the other is about to change.
export const vacationTimeLock = (requestId: string) => `time-off:${requestId}`;
