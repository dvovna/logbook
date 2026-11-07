import UserRole from '@common/enums/user-role.enum';
import {
  ADMIN_AND_HR_ROLES,
  ALL_ROLES,
  MANAGER_ROLES,
} from '@common/constants/role-groups';
import { TabId } from '@modules/slack/common/services/tab-navigation.service';

// Who may open each App Home tab. Navigation buttons are hidden by role, but
// Slack takes action ids from the client, so a member can still send
// "open the Users tab": BaseTabService checks this before publishing a tab.
// What a tab then shows (e.g. only a manager's teams) is up to the tab.
export const TAB_ALLOWED_ROLES: Record<TabId, readonly UserRole[]> = {
  // Everyone's own data: overview, own vacation history, own time entries.
  [TabId.Home]: ALL_ROLES,
  [TabId.VacationsHistory]: ALL_ROLES,
  [TabId.TimeEntries]: ALL_ROLES,

  [TabId.People]: MANAGER_ROLES,
  [TabId.Users]: MANAGER_ROLES,
  [TabId.Vacations]: MANAGER_ROLES,
  [TabId.VacationRequests]: MANAGER_ROLES,
  [TabId.TimeAndBilling]: MANAGER_ROLES,
  [TabId.TimeApprovals]: MANAGER_ROLES,
  [TabId.Projects]: MANAGER_ROLES,
  [TabId.Clients]: MANAGER_ROLES,

  [TabId.Teams]: ADMIN_AND_HR_ROLES,
  [TabId.VacationPolicies]: ADMIN_AND_HR_ROLES,
  [TabId.Holidays]: ADMIN_AND_HR_ROLES,
};

export const canOpenTab = (tabId: TabId, role: UserRole) =>
  TAB_ALLOWED_ROLES[tabId].includes(role);
