export enum BillingSnapshotsTabActionId {
  ManageSnapshotMenu = 'manage_billing_snapshot_menu',
  // Sends the snapshot as a CSV file in a DM.
  ExportSnapshot = 'export_billing_snapshot',
  MarkInvoiced = 'mark_billing_snapshot_invoiced',
  // An admin's: deletes the snapshot, which frees its entries.
  UnlockSnapshot = 'unlock_billing_snapshot',
  PaginationPrev = 'billing_snapshots_pagination_prev',
  PaginationNext = 'billing_snapshots_pagination_next',
}

export enum BillingSnapshotsModalName {
  MarkInvoiced = 'MarkInvoiced',
  Unlock = 'Unlock',
}
