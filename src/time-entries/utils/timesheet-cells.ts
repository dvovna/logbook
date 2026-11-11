import { sumMinutes } from '@common/utils/time.utils';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  ITimesheetCell,
  TimesheetCellLock,
} from 'src/time-entries/types/timesheet.types';

export const isNotCancelled = (entry: ITimeEntryViewModel) =>
  entry.status !== TimeEntryStatus.Cancelled;

// Projects without a client last.
export const byClientAndName = (
  a: { clientName: string | null; name: string },
  b: { clientName: string | null; name: string },
) =>
  Number(!a.clientName) - Number(!b.clientName) ||
  (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
  a.name.localeCompare(b.name);

// The cell of `entries`, a project's on `date` that aren't cancelled.
export const buildCell = (
  date: string,
  entries: ITimeEntryViewModel[],
  projectLocked: boolean,
  billedIds: Set<string>,
): ITimesheetCell => {
  const [only] = entries.length === 1 ? entries : [];
  let lock: TimesheetCellLock | null = null;

  if (projectLocked) {
    lock = 'project';
  } else if (entries.length > 1) {
    lock = 'several';
  } else if (only && billedIds.has(only.id)) {
    lock = 'billed';
  } else if (only?.status === TimeEntryStatus.Approved) {
    lock = 'approved';
  } else if (only?.status === TimeEntryStatus.Submitted) {
    lock = 'submitted';
  }

  return {
    date,
    minutes: sumMinutes(entries),
    entryCount: entries.length,
    lock,
  };
};
