import { ADMIN_TABS } from 'src/slack/common/views/data/admin-tabs';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { AnyBlock } from '@slack/web-api';

export class AdminTabNavigation {
  public static getNavigationBlocks(
    activeTabActionId: AdminNavigationActionId | null,
  ): AnyBlock[] {
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
        elements: ADMIN_TABS.map((tab) => ({
          type: 'button',
          text: { type: 'plain_text', text: tab.title },
          action_id: tab.actionId,
          ...(tab.actionId === activeTabActionId ? { style: 'primary' } : {}),
        })),
      },
    ];
  }
}
