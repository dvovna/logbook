export enum BillingSnapshotsTabActionId {
  ManageSnapshotMenu = 'manage_billing_snapshot_menu',
  // Sends the snapshot as a CSV file in a DM.
  ExportSnapshot = 'export_billing_snapshot',
  MarkInvoiced = 'mark_billing_snapshot_invoiced',
  // Takes the invoiced mark off, e.g. one set by mistake.
  MarkNotInvoiced = 'mark_billing_snapshot_not_invoiced',
  FilterByClient = 'filter_billing_snapshots_by_client',
  // An admin's: deletes the snapshot, which frees its entries.
  UnlockSnapshot = 'unlock_billing_snapshot',
  PaginationPrev = 'billing_snapshots_pagination_prev',
  PaginationNext = 'billing_snapshots_pagination_next',
}

export enum BillingSnapshotsModalName {
  MarkInvoiced = 'MarkInvoiced',
  MarkNotInvoiced = 'MarkNotInvoiced',
  Unlock = 'Unlock',
}
