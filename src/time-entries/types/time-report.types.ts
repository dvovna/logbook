import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import {
  ITimeScopeFilter,
  TimeScopeKind,
} from 'src/time-entries/types/time-scope.types';

// A client's, project's, person's or team's time in the period.
export interface ITimeReportRow {
  name: string;
  minutes: number;
  billableMinutes: number;
  approvedMinutes: number;
  // In cents, of the billable time that has a rate; null for those who don't
  // see amounts (RATE_ROLES).
  amount: number | null;
}

// What a time report and its CSV may be narrowed to. IDs come from the form,
// so they only ever narrow the viewer's scope: an ID they may not see, or of
// another workspace, matches nothing.
export interface ITimeReportFilters {
  clientId?: string;
  projectId?: string;
  userId?: string;
}

// The names of the filters a report was narrowed by, to show with it.
export interface IAppliedFilters {
  client?: string;
  project?: string;
  person?: string;
}

export interface ITimeReport {
  groupBy: TimeReportGrouping;
  fromDate: string;
  toDate: string;
  scope: TimeScopeKind;
  filters: IAppliedFilters;
  // The workspace's currency; null for those who don't see amounts.
  currency: string | null;
  // Most time first.
  rows: ITimeReportRow[];
  total: ITimeReportRow;
  // Billable time without a rate, so without an amount; null for those who
  // don't see amounts.
  unratedMinutes: number | null;
  // How many entries the report adds up: the lines of its CSV.
  entryCount: number;
}

// A person who has not sent all their time of the period for approval.
export interface IMissingTimeLine {
  name: string;
  teamName: string | null;
  // Everything they logged in the period, whatever its status.
  loggedMinutes: number;
  // Drafts and rejected entries: not sent for approval (again) yet.
  unsubmittedMinutes: number;
  unsubmittedCount: number;
}

export interface IMissingTimeReport {
  fromDate: string;
  toDate: string;
  scope: TimeScopeKind;
  // Everyone the viewer sees, listed or not.
  peopleCount: number;
  // Who logged nothing first, then most unsubmitted time.
  lines: IMissingTimeLine[];
}

// The entries a time report and its CSV read: a period's, deleted ones left
// out, within the viewer's scope, then narrowed by the filters.
export interface IReportEntriesQuery {
  dateFrom: string;
  dateTo: string;
  scope: ITimeScopeFilter;
  filters: ITimeReportFilters;
}

// A group's time as the database adds it up. The key is null for the
// entries without a client or a team; the name is null when the group has
// none to show.
export interface ITimeReportGroupSum {
  key: string | null;
  name: string | null;
  entries: number;
  minutes: number;
  billableMinutes: number;
  approvedMinutes: number;
  // In cents: the billable time of each project and person at their rate,
  // rounded, then added up.
  amount: number;
  // Billable time without a rate.
  unratedMinutes: number;
}

// A person's time in a period.
export interface IUserTimeSum {
  userId: string;
  minutes: number;
  // Drafts and rejected entries.
  openMinutes: number;
  openCount: number;
}

// An entry as the time report's CSV shows it, with the names it needs.
export interface ITimeReportCsvRow {
  id: string;
  work_date: string;
  created_at: string;
  // The person's and the project's names, '' when none: the CSV is sorted
  // by them.
  person: string;
  email: string | null;
  team: string | null;
  // The project's client, else the entry's.
  client: string | null;
  project: string;
  description: string | null;
  minutes: number;
  billable: boolean;
  status: TimeEntryStatus;
  // The person's own rate on the project, else the project's; null without
  // one, and when rates weren't asked for.
  hourly_rate: number | null;
}

// Where the next page of the CSV starts: after the line with these sort
// keys.
export type TimeReportCsvCursor = Pick<
  ITimeReportCsvRow,
  'work_date' | 'person' | 'project' | 'created_at' | 'id'
>;
