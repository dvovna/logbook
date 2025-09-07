import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';

export const ADMIN_TABS = [
  {
    actionId: AdminNavigationActionId.ViewHome,
    title: '🏠 Home',
  },
  {
    actionId: AdminNavigationActionId.ManageUsers,
    title: '👤 Users',
  },
  {
    actionId: AdminNavigationActionId.ManageTeams,
    title: '👥 Teams',
  },
  {
    actionId: AdminNavigationActionId.ManageVacationRequests,
    title: '📅 Requests',
  },
  {
    actionId: AdminNavigationActionId.ManageVacationPolicies,
    title: '📜 Policies & Holidays',
  },
];
