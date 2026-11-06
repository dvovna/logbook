import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';

// The statuses in which the owner may still change, delete and submit an
// entry. Once submitted it waits for approval and only Admin and HR change it.
export const OPEN_TIME_ENTRY_STATUSES = [
  TimeEntryStatus.Draft,
  TimeEntryStatus.Rejected,
];

export const isOpenTimeEntry = (status: TimeEntryStatus) =>
  OPEN_TIME_ENTRY_STATUSES.includes(status);
