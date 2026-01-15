export enum ViewCallbackId {
  HomeTabView = 'home_tab_view',
  CancelVacationRequestFormSubmit = 'cancel_vacation_request_form_submit',

  // workflow steps
  WorkflowStepMessage = 'workflow_step_message',
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
  ViewVacationRequestDetails = 'view_vacation_request_details',

  // approver-step-comments
  ApproverMessageCommentFormSubmit = 'approver_message_comment_form_submit',

  // general
  FallbackTabView = 'fallback_tab_view',

  // people
  PeopleTabView = 'people_tab_view',

  // vacations
  VacationsTabView = 'vacations_tab_view',

  // time-and-billing
  TimeAndBillingTabView = 'time_and_billing_tab_view',
}
