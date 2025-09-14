import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';

export const ADMIN_TABS = [
  {
    actionId: AdminNavigationActionId.ViewHome,
    title: '🏠 Home',
  },
  {
    actionId: AdminNavigationActionId.ManageVacationRequests,
    title: '📅 Requests',
  },
  {
    actionId: AdminNavigationActionId.ManageTeams,
    title: '👥 Teams',
  },
  {
    actionId: AdminNavigationActionId.ManageVacationPolicies,
    title: '📜 Policies & Holidays',
  },
  {
    actionId: AdminNavigationActionId.ManageUsers,
    title: '👤 Users',
  },
];
