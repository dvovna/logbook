import { ADMIN_TABS } from '@modules/slack/common/views/data/admin-tabs';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { AnyBlock } from '@slack/web-api';

export class AdminTabNavigation {
  public static getNavigationBlocks(
    activeTabActionId: AdminNavigationActionId | null,
    canViewTab: (tabActionId: AdminNavigationActionId) => boolean,
  ): AnyBlock[] {
    const tabs = ADMIN_TABS.filter((tab) =>
      canViewTab(tab.actionId));

    if (tabs.length <= 1) {
      return [];
    }

    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*⚙ Admin Panel*\nManage users, teams, vacation requests and policies.',
        },
      },
      {
        type: 'actions',
        elements: tabs.map((tab) => ({
          type: 'button',
          text: { type: 'plain_text', text: tab.title },
          action_id: tab.actionId,
          ...(tab.actionId === activeTabActionId ? { style: 'primary' } : {}),
        })),
      },
    ];
  }
}
