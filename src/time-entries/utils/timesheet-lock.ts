// The advisory lock on one person's time entries. A timesheet save takes it,
// and so does logging a time off as time, after the request's lock
// (vacationTimeLock, `time-off:<request id>`). Nothing takes the two in the
// other order, so neither ever waits for the other in a cycle; keep it so.
export const timesheetLock = (userId: string) => `timesheet:${userId}`;
