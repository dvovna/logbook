// The buttons and menus of Finance's Receipts screen and its child screen,
// Reimbursements. A menu's options carry `<action>:<id>`.
export enum ReceiptsTabActionId {
  AcceptReceipt = 'accept_receipt',
  RejectReceipt = 'reject_receipt',
  // The ⋯ menu of a decided receipt: the opposite decision.
  ManageReceiptMenu = 'check_receipt_menu',
  PreviousMonth = 'receipts_previous_month',
  NextMonth = 'receipts_next_month',
  SelectReimbursement = 'receipts_select_reimbursement',
  // All of one person's receipts of the month, and back to everyone.
  ShowPerson = 'receipts_show_person',
  AllPeople = 'receipts_all_people',
  PaginationPrev = 'receipts_pagination_prev',
  PaginationNext = 'receipts_pagination_next',

  OpenReimbursements = 'open_reimbursements',
  AddReimbursement = 'add_reimbursement',
  ManageReimbursementMenu = 'manage_reimbursement_menu',
  EditReimbursement = 'edit_reimbursement',
  ArchiveReimbursement = 'archive_reimbursement',
}

export enum ReceiptsModalName {
  RejectReceipt = 'RejectReceipt',
  AddReimbursement = 'AddReimbursement',
  EditReimbursement = 'EditReimbursement',
  ArchiveReimbursement = 'ArchiveReimbursement',
}
