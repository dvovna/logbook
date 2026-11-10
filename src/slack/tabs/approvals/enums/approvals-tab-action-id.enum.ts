export enum ApprovalsTabActionId {
  ApproveTimeOff = 'approve_time_off_request',
  RejectTimeOff = 'reject_time_off_request',
  TimeOffMenu = 'time_off_request_menu',
  CommentTimeOff = 'comment_time_off_request',
  TimeOffDetails = 'time_off_request_details',
  AllPendingTimeOff = 'all_pending_time_off_requests',

  ApproveEntry = 'approve_time_entry',
  RejectEntry = 'reject_time_entry',
  ApproveAll = 'approve_all_time_entries',
  // Admin and HR: every submitted entry, or back to those waiting for them.
  ShowAllEntries = 'show_all_pending_time_entries',
  ShowWaitingEntries = 'show_time_entries_waiting_for_me',
  PaginationPrev = 'time_approvals_pagination_prev',
  PaginationNext = 'time_approvals_pagination_next',
}

export enum ApprovalsTabModalName {
  ApproveTimeOff = 'ApproveTimeOff',
  RejectTimeOff = 'RejectTimeOff',
  CommentTimeOff = 'CommentTimeOff',
  TimeOffDetails = 'TimeOffDetails',
  RejectEntry = 'RejectEntry',
  ApproveAll = 'ApproveAll',
}
