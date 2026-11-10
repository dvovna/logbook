import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// Why a cell can't be changed in the week form: it holds several entries, its
// entry waits for approval, is approved or is in a billing snapshot, or its
// project is archived or not the viewer's to log on.
export type TimesheetCellLock =
  'several' | 'submitted' | 'approved' | 'billed' | 'project';

export interface ITimesheetCell {
  date: string;
  minutes: number;
  entryCount: number;
  lock: TimesheetCellLock | null;
}

export interface ITimesheetRow {
  projectId: string;
  projectName: string;
  clientName: string | null;
  cells: ITimesheetCell[];
}

export interface ITimesheetWeek {
  weekStart: string;
  // Monday to Sunday.
  days: string[];
  rows: ITimesheetRow[];
  dayTotals: number[];
  total: number;
  statusCounts: Record<TimeEntryStatus, number>;
}

// For the list under My time's week: the week's entries that aren't deleted
// (cancelled ones too, as the list shows them), and which are billed.
export interface ITimesheetWeekWithEntries {
  week: ITimesheetWeek;
  entries: ITimeEntryViewModel[];
  billedIds: Set<string>;
}

// The drafts and rejected entries of a user dated before a shown week.
export interface ITimesheetOpenBefore {
  count: number;
  // The Monday of the oldest one's week.
  weekStart: string;
}

export interface ITimesheetCellInput {
  projectId: string;
  date: string;
  // null: no time (an empty cell, or 0).
  minutes: number | null;
  // What the form showed in the cell when it opened, null for nothing.
  shownMinutes: number | null;
}

export interface ITimesheetSaveResult {
  // The user's time in the inputs' week after saving.
  minutes: number;
  // The same for each day of that week (all seven, by date).
  minutesByDate: Record<string, number>;
}
