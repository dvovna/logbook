export enum ReportsModalName {
  BillingReport = 'BillingReport',
  TimeReport = 'TimeReport',
}

export enum ReportsTabActionId {
  BillingReport = 'open_billing_report',
  TimeReport = 'open_time_report',
  // Sends the time report on show as a CSV file in a DM.
  ExportTimeReport = 'export_time_report',
}
