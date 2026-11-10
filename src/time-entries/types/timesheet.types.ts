import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';

// Why a cell can't be changed in the week form: it holds several entries, its
// entry waits for approval, is approved or is in a billing snapshot, or its
// project is archived or not the viewer's to log on.
export type TimesheetCellLock =
  'several' | 'submitted' | 'approved' | 'billed' | 'project';

export interface ITimesheetCell {
  date: string;
  minutes: number;
  // The cell's entry; null when it has none or several.
  entryId: string | null;
  // How many entries the cell sums up.
  entryCount: number;
  lock: TimesheetCellLock | null;
}

export interface ITimesheetRow {
  projectId: string;
  projectName: string;
  clientName: string | null;
  // One cell per day of the week.
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

// The drafts and rejected entries of a user dated before a shown week.
export interface ITimesheetOpenBefore {
  count: number;
  // The Monday of the oldest one's week.
  weekStart: string;
}

// The most project rows the week form offers.
export const MAX_TIMESHEET_ROWS = 10;

// A cell of a project and a day: the block_id and action_id of its input in
// the forms, and the field of an error about it.
export const cellKey = (projectId: string, date: string) =>
  `${projectId}_${date}`;

// What a form sends for one cell.
export interface ITimesheetCellInput {
  projectId: string;
  date: string;
  // null: no time (an empty cell, or 0).
  minutes: number | null;
  // What the form showed in the cell when it opened, null for nothing.
  shownMinutes: number | null;
}

export interface ITimesheetSaveResult {
  created: number;
  updated: number;
  deleted: number;
  // The user's time in the inputs' week after saving.
  minutes: number;
  // The same for each day of that week (all seven, by date).
  minutesByDate: Record<string, number>;
}
