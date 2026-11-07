// The buttons that open a screen (SCREENS): the navigation row, the Settings
// row, Back, and links between screens. Every tab handles all of them
// (BaseTabActionHandler), so any screen can show any of them.
export enum NavigationActionId {
  Home = 'nav_home',
  MyTime = 'nav_my_time',
  TimeOff = 'nav_time_off',
  Approvals = 'nav_approvals',
  People = 'nav_people',
  Reports = 'nav_reports',
  // The first Settings screen the role may open.
  Settings = 'nav_settings',

  Teams = 'nav_teams',
  Policies = 'nav_policies',
  Projects = 'nav_projects',
  Clients = 'nav_clients',

  AllRequests = 'nav_all_requests',
  TimeLogs = 'nav_time_logs',
}
