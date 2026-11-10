import UserRole from '@common/enums/user-role.enum';
import {
  ADMIN_AND_HR_ROLES,
  ALL_ROLES,
  MANAGER_ROLES,
} from '@common/constants/role-groups';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';

// Every screen of the App Home, in one place: the navigation row, the
// Settings row and Back are built from it (ScreenHeader), BaseTabService
// refuses a screen the role may not open, and every tab handles its buttons
// (BaseTabActionHandler). A new screen needs an entry here.
export enum ScreenId {
  Home = 'home',
  MyTime = 'my_time',
  TimeOff = 'time_off',
  Approvals = 'approvals',
  People = 'people',
  Reports = 'reports',

  Teams = 'teams',
  Policies = 'policies',
  Projects = 'projects',
  Clients = 'clients',

  Holidays = 'holidays',
  AllRequests = 'all_requests',
  TimeLogs = 'time_logs',
}

export interface IScreen {
  // With its icon, as on its button: '🏢 Teams'.
  title: string;
  roles: readonly UserRole[];
  // The tab that shows it.
  tabId: TabId;
  // What the tab gets to show this screen, e.g. only the viewer's entries.
  metadata?: Record<string, unknown>;
  // The button that opens it; a screen without one opens from another one
  // (Holidays from a policy's menu).
  actionId?: NavigationActionId;
  // In the Settings row rather than the navigation row.
  inSettings?: boolean;
  // Opened from that screen: Back goes there, and the navigation marks it.
  parent?: ScreenId;
}

export const SCREENS: Record<ScreenId, IScreen> = {
  [ScreenId.Home]: {
    title: '🏠 Home',
    roles: ALL_ROLES,
    tabId: TabId.Home,
    actionId: NavigationActionId.Home,
  },
  [ScreenId.MyTime]: {
    title: '🕒 My time',
    roles: ALL_ROLES,
    tabId: TabId.TimeEntries,
    metadata: { ownEntriesOnly: true },
    actionId: NavigationActionId.MyTime,
  },
  [ScreenId.TimeOff]: {
    title: '🌴 Time off',
    roles: ALL_ROLES,
    tabId: TabId.TimeOff,
    actionId: NavigationActionId.TimeOff,
  },
  [ScreenId.Approvals]: {
    title: '✅ Approvals',
    roles: MANAGER_ROLES,
    tabId: TabId.Approvals,
    actionId: NavigationActionId.Approvals,
  },
  [ScreenId.People]: {
    title: '👥 People',
    roles: MANAGER_ROLES,
    tabId: TabId.Users,
    actionId: NavigationActionId.People,
  },
  // Time reports for everyone, each of their own scope (a member's own time,
  // a manager's teams); the billing report and everyone's time logs are for
  // Admin and HR.
  [ScreenId.Reports]: {
    title: '📊 Reports',
    roles: ALL_ROLES,
    tabId: TabId.Reports,
    actionId: NavigationActionId.Reports,
  },

  [ScreenId.Teams]: {
    title: '🏢 Teams',
    roles: ADMIN_AND_HR_ROLES,
    tabId: TabId.Teams,
    actionId: NavigationActionId.Teams,
    inSettings: true,
  },
  [ScreenId.Policies]: {
    title: '📜 Policies',
    roles: ADMIN_AND_HR_ROLES,
    tabId: TabId.VacationPolicies,
    actionId: NavigationActionId.Policies,
    inSettings: true,
  },
  [ScreenId.Projects]: {
    title: '📁 Projects',
    roles: MANAGER_ROLES,
    tabId: TabId.Projects,
    actionId: NavigationActionId.Projects,
    inSettings: true,
  },
  [ScreenId.Clients]: {
    title: '💼 Clients',
    roles: MANAGER_ROLES,
    tabId: TabId.Clients,
    actionId: NavigationActionId.Clients,
    inSettings: true,
  },

  [ScreenId.Holidays]: {
    title: '🎉 Holidays',
    roles: ADMIN_AND_HR_ROLES,
    tabId: TabId.Holidays,
    parent: ScreenId.Policies,
  },
  [ScreenId.AllRequests]: {
    title: '📋 All requests',
    roles: MANAGER_ROLES,
    tabId: TabId.VacationRequests,
    actionId: NavigationActionId.AllRequests,
    parent: ScreenId.TimeOff,
  },
  [ScreenId.TimeLogs]: {
    title: '⏱ Time logs',
    roles: ADMIN_AND_HR_ROLES,
    tabId: TabId.TimeEntries,
    actionId: NavigationActionId.TimeLogs,
    parent: ScreenId.Reports,
  },
};

// The navigation row, in order; Settings stands for the Settings screens.
export const NAVIGATION_ROW = [
  ScreenId.Home,
  ScreenId.MyTime,
  ScreenId.TimeOff,
  ScreenId.Approvals,
  ScreenId.People,
  ScreenId.Reports,
  NavigationActionId.Settings,
] as const;

export const SETTINGS_TITLE = '⚙️ Settings';

export const canOpenScreen = (screenId: ScreenId, role: UserRole) =>
  SCREENS[screenId].roles.includes(role);

export const settingsScreensFor = (role: UserRole): ScreenId[] =>
  (Object.keys(SCREENS) as ScreenId[]).filter(
    (id) => SCREENS[id].inSettings && canOpenScreen(id, role),
  );

// The screen a tab shows with `metadata`: of the tab's screens, the one whose
// metadata it has (My time has ownEntriesOnly), else the one without any.
export const screenOfTab = (tabId: TabId, metadata: object = {}): ScreenId => {
  const candidates = (Object.keys(SCREENS) as ScreenId[]).filter(
    (id) =>
      SCREENS[id].tabId === tabId &&
      Object.entries(SCREENS[id].metadata ?? {}).every(
        ([key, value]) => (metadata as Record<string, unknown>)[key] === value,
      ),
  );
  const keysOf = (id: ScreenId) => Object.keys(SCREENS[id].metadata ?? {});

  candidates.sort((a, b) => keysOf(b).length - keysOf(a).length);

  if (!candidates.length) {
    throw new Error(`No screen for the tab ${tabId}`);
  }

  return candidates[0];
};

// The top of a screen's family: itself, or the screen it was opened from.
export const rootOf = (screenId: ScreenId): ScreenId => {
  const { parent } = SCREENS[screenId];

  return parent ? rootOf(parent) : screenId;
};

// Who may use a tab at all: everyone who may open one of its screens. Its
// action handler allows these roles.
export const rolesOfTab = (tabId: TabId): readonly UserRole[] => {
  const roles = new Set<UserRole>();

  for (const screen of Object.values(SCREENS)) {
    if (screen.tabId === tabId) {
      screen.roles.forEach((role) => roles.add(role));
    }
  }

  return ALL_ROLES.filter((role) => roles.has(role));
};

// What a navigation button opens for `role`.
export const screenOfAction = (
  actionId: NavigationActionId,
  role: UserRole,
): ScreenId | undefined =>
  actionId === NavigationActionId.Settings
    ? settingsScreensFor(role)[0]
    : (Object.keys(SCREENS) as ScreenId[]).find(
        (id) => SCREENS[id].actionId === actionId,
      );
