import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';

export const ADMIN_TABS = [
  {
    actionId: AdminNavigationActionId.ViewHome,
    title: '🏠 Overview',
  },
  {
    actionId: AdminNavigationActionId.ManagePeople,
    title: '👥 People',
  },
  {
    actionId: AdminNavigationActionId.ManageTime,
    title: '⏱ Time & Billing',
  },
  {
    actionId: AdminNavigationActionId.ManageVacations,
    title: '📅 Vacations',
  },
];
