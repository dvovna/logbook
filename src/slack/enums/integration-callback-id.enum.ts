export enum ViewCallbackId {
  HomeTabView = 'home_tab_view',
  CancelVacationRequestFormSubmit = 'cancel_vacation_request_form_submit',
  CancelVacationRequestCommandSubmit = 'cancel_vacation_request_command_submit',

  // workflow steps
  WorkflowStepMessage = 'workflow_step_message',
  // The buttons of a DM to the requester about their pending request.
  RequesterNoticeMessage = 'requester_notice_message',
  ApproveRequestStepMessage = 'approve_request_step_message',
  RejectRequestStepMessage = 'reject_request_step_message',

  // holidays
  HolidaysTabView = 'holidays_tab_view',
  ImportHolidays = 'import_holidays',
  ToggleHolidayStatus = 'toggle_holiday_status',
  HolidayFormSubmit = 'holiday_form_submit',
  DeleteHoliday = 'delete_holiday',

  // users
  UsersTabView = 'users_tab_view',
  UserFormSubmit = 'user_form_submit',
  ChangeUserStatus = 'change_user_status',
  ViewUserVacationUsage = 'view_user_vacation_usage',

  // teams
  TeamsTabView = 'teams_tab_view',
  DeleteTeam = 'delete_team',
  TeamFormSubmit = 'team_form_submit',
  CompanyRulesSubmit = 'company_rules_submit',

  // The buttons of the DM that previews a team file.
  TeamFileMessage = 'team_file_message',

  // The buttons of the DM that previews a leave balances or history file.
  LeaveFileMessage = 'leave_file_message',

  // The DM that asks HR which team a new person is on.
  NewPersonPrompt = 'new_person_prompt',

  // vacation-policies
  VacationPoliciesTabView = 'vacation_policies_tab_view',
  DeleteVacationPolicy = 'delete_vacation_policy',
  VacationPolicyFormSubmit = 'vacation_policy_form_submit',

  // vacation-requests
  VacationRequestsTabView = 'vacation_requests_tab_view',
  VacationHistoryTabView = 'vacation_history_tab_view',
  AdminVacationRequest = 'admin_vacation_request',
  UserVacationRequest = 'user_vacation_request',
  DeleteVacationRequest = 'delete_vacation_request',
  ApproveVacationRequestOnBehalf = 'approve_vacation_request_on_behalf',
  ViewVacationRequestDetails = 'view_vacation_request_details',
  TimeOffLoggingOffer = 'time_off_logging_offer',

  // approver-step-comments
  ApproverMessageCommentFormSubmit = 'approver_message_comment_form_submit',

  // general
  FallbackTabView = 'fallback_tab_view',

  // time tracking and reports
  TimeEntriesTabView = 'time_entries_tab_view',
  DeleteTimeEntry = 'delete_time_entry',
  ReportsTabView = 'reports_tab_view',

  // projects
  ProjectsTabView = 'projects_tab_view',
  ChangeProjectStatus = 'change_project_status',
  ProjectFormSubmit = 'project_form_submit',
  ProjectAssignmentsFormSubmit = 'project_assignments_form_submit',
  PersonRateFormSubmit = 'person_rate_form_submit',
  CurrencyFormSubmit = 'currency_form_submit',
  TimeOffSettingsForm = 'time_off_settings_form',

  // time-entries
  UserTimeEntry = 'user_time_entry',
  AdminTimeEntry = 'admin_time_entry',
  TimesheetForm = 'timesheet_form',

  // approvals
  ApprovalsTabView = 'approvals_tab_view',
  RejectTimeEntry = 'reject_time_entry',
  ApproveAllTimeEntries = 'approve_all_time_entries',

  // billing-reports
  BillingReportFormSubmit = 'billing_report_form_submit',

  // time reports
  TimeReportFormSubmit = 'time_report_form_submit',

  // billing snapshots and the uninvoiced report
  UninvoicedReportFormSubmit = 'uninvoiced_report_form_submit',
  BillingSnapshotsTabView = 'billing_snapshots_tab_view',
  CreateBillingSnapshot = 'create_billing_snapshot',
  MarkBillingSnapshotInvoiced = 'mark_billing_snapshot_invoiced',
  MarkBillingSnapshotNotInvoiced = 'mark_billing_snapshot_not_invoiced',
  UnlockBillingSnapshot = 'unlock_billing_snapshot',

  // clients
  ClientsTabView = 'clients_tab_view',
  ClientFormSubmit = 'client_form_submit',
  ChangeClientStatus = 'change_client_status',

  // receipts
  // The DM that waits for the details of a receipt the person sent.
  ReceivedReceiptMessage = 'received_receipt_message',
  ReceiptDetailsForm = 'receipt_details_form',
}
