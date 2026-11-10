export enum ReportsModalName {
  BillingReport = 'BillingReport',
  TimeReport = 'TimeReport',
  // Confirms locking a billing report's approved time in a snapshot.
  LockSnapshot = 'LockSnapshot',
}

export enum ReportsTabActionId {
  BillingReport = 'open_billing_report',
  TimeReport = 'open_time_report',
  // Sends the time report on show as a CSV file in a DM.
  ExportTimeReport = 'export_time_report',
  // Locks the billing report on show in a snapshot (after a confirmation).
  LockSnapshot = 'lock_billing_snapshot',
  // Shows what hasn't been invoiced, per client.
  Uninvoiced = 'open_uninvoiced_report',
}
