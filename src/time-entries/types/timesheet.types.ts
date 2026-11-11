import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserProject } from 'src/projects/queries/get-user-projects.query';

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

// A cell of the week: a project and a day.
export interface ITimesheetCellRef {
  projectId: string;
  date: string;
}

export interface ITimesheetCellChange extends ITimesheetCellRef {
  // null: no time (an empty cell, or 0).
  minutes: number | null;
  // What the cell held when the form showed it, null for nothing. A cell
  // given other minutes is refused when it no longer holds these.
  expectedMinutes: number | null;
}

export interface ITimesheetSaveResult {
  // The user's time in the cells' week after saving.
  minutes: number;
  // The same for each day of that week (all seven, by date).
  minutesByDate: Record<string, number>;
}

export interface ITimesheetProject {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  billable: boolean;
  archived: boolean;
}

export interface IProjectsOfUser {
  // Every project, archived ones too, by ID.
  projects: Map<string, ITimesheetProject>;
  // The ones the user may log time on, in the order of get_user_projects.
  allowed: IUserProject[];
}

// The user's entries of a period that aren't deleted, cancelled ones
// included, and which of them are billed.
export interface IEntriesOfUser {
  entries: ITimeEntryViewModel[];
  billedIds: Set<string>;
}

// What a save does to a cell: creates an entry (no `entry`), changes its
// minutes or deletes it (null minutes).
export interface ITimesheetCellWrite {
  change: ITimesheetCellChange;
  project: ITimesheetProject;
  entry?: ITimeEntryViewModel;
}
