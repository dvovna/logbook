// The buttons that open a screen (SCREENS): the navigation row and the
// values of its More menu, Back, and links between screens. Every tab
// handles all of them (BaseTabActionHandler), so any screen can show any.
export enum NavigationActionId {
  Home = 'nav_home',
  MyTime = 'nav_my_time',
  TimeOff = 'nav_time_off',
  Approvals = 'nav_approvals',
  People = 'nav_people',
  Reports = 'nav_reports',
  // The first Settings screen the role may open: the Settings button of the
  // views published before the More menu, which Home tabs still show until
  // they are published again.
  Settings = 'nav_settings',

  Teams = 'nav_teams',
  Policies = 'nav_policies',
  Projects = 'nav_projects',
  Clients = 'nav_clients',

  AllRequests = 'nav_all_requests',
  TimeLogs = 'nav_time_logs',
  BillingSnapshots = 'nav_billing_snapshots',

  // The More menu of the navigation row: the chosen option's value is one
  // of the actions above.
  Menu = 'nav_menu',
}
