// The App Home tabs: each is a BaseTabService that shows one screen or more
// (SCREENS), e.g. TimeEntries shows My time and Time logs.
export enum TabId {
  Home = 'home_tab',
  TimeOff = 'time_off_tab',
  Approvals = 'approvals_tab',
  Reports = 'reports_tab',
  TimeEntries = 'time_entries_tab',
  Users = 'users_tab',
  Teams = 'teams_tab',
  VacationPolicies = 'vacation_policies_tab',
  Holidays = 'holidays_tab',
  Projects = 'projects_tab',
  Clients = 'clients_tab',
  VacationRequests = 'vacation_requests_tab',
  BillingSnapshots = 'billing_snapshots_tab',
  MyReceipts = 'my_receipts_tab',
  Receipts = 'receipts_tab',
}
