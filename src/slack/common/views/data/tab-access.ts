import UserRole from '@common/enums/user-role.enum';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';

const EVERYONE = [
  UserRole.Admin,
  UserRole.HR,
  UserRole.Manager,
  UserRole.Member,
];
const MANAGERS = [UserRole.Admin, UserRole.HR, UserRole.Manager];
const ADMIN_AND_HR = [UserRole.Admin, UserRole.HR];

// Who may open each App Home tab. Navigation buttons are hidden by role, but
// Slack takes action ids from the client, so a member can still send
// "open the Users tab": BaseTabService checks this before publishing a tab.
// What a tab then shows (e.g. only a manager's teams) is up to the tab.
export const TAB_ALLOWED_ROLES: Record<TabId, UserRole[]> = {
  // Everyone's own data: overview, own vacation history, own time entries.
  [TabId.Home]: EVERYONE,
  [TabId.VacationsHistory]: EVERYONE,
  [TabId.TimeEntries]: EVERYONE,

  [TabId.People]: MANAGERS,
  [TabId.Users]: MANAGERS,
  [TabId.Vacations]: MANAGERS,
  [TabId.VacationRequests]: MANAGERS,
  [TabId.TimeAndBilling]: MANAGERS,
  [TabId.TimeApprovals]: MANAGERS,
  [TabId.Projects]: MANAGERS,
  [TabId.Clients]: MANAGERS,

  [TabId.Teams]: ADMIN_AND_HR,
  [TabId.VacationPolicies]: ADMIN_AND_HR,
  [TabId.Holidays]: ADMIN_AND_HR,
};

export const canOpenTab = (tabId: TabId, role: UserRole) =>
  TAB_ALLOWED_ROLES[tabId].includes(role);
