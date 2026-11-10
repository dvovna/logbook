interface INamed {
  id: string;
  name: string;
}

// A billing snapshot as stored, with the amount in cents.
export interface IBillingSnapshotViewModel {
  id: string;
  slack_team_id: string;
  client_id: string;
  client: INamed | null;
  period_start: string;
  period_end: string;
  // The workspace's currency when the snapshot was made.
  currency: string;
  total_minutes: number;
  billable_minutes: number;
  // Of the billable time that had a rate, in cents.
  total_amount_cents: number;
  created_at: string;
  created_by: string | null;
  creator: INamed | null;
  invoiced_at: string | null;
  invoiced_by: string | null;
  invoicer: INamed | null;
}

// A snapshot's entries counted: how many, and the billable time without a
// rate (so without an amount).
export interface ISnapshotEntryStats {
  entryCount: number;
  unratedMinutes: number;
}

export type IBillingSnapshot = IBillingSnapshotViewModel & ISnapshotEntryStats;

// An approved time entry that is in no snapshot yet.
export interface IUnbilledEntry {
  id: string;
  user_id: string;
  project_id: string;
  minutes: number;
  billable: boolean;
}

// A line of a snapshot to store: the entry, and the rate and amount it is
// billed at.
export interface ISnapshotLineInsert {
  timeEntryId: string;
  minutes: number;
  billable: boolean;
  hourlyRate: number | null;
  // In cents; null without a rate or when the entry isn't billable.
  amountCents: number | null;
}

// A line of a snapshot with its entry, for the CSV.
export interface ISnapshotLine {
  workDate: string;
  personName: string | null;
  email: string | null;
  teamName: string | null;
  projectName: string | null;
  description: string | null;
  minutes: number;
  billable: boolean;
  hourlyRate: number | null;
  amountCents: number | null;
  createdAt: string;
}

// A period that may be open on either side: no date is no limit.
export interface IOpenPeriod {
  fromDate?: string;
  toDate?: string;
}

// A client's approved billable time that isn't in a snapshot, at today's
// rates.
export interface IUnbilledClientTime {
  clientId: string;
  minutes: number;
  amountCents: number;
  unratedMinutes: number;
  // The earliest day of it.
  since: string;
}

// A client's snapshots that aren't marked invoiced yet, added up.
export interface INotInvoicedClientTime {
  clientId: string;
  snapshotCount: number;
  billableMinutes: number;
  amountCents: number;
}
