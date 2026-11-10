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

// The most project rows the week form offers.
export const MAX_TIMESHEET_ROWS = 10;
