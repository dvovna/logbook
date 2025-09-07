import { AnyBlock } from '@slack/web-api';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { AdminTabNavigation } from 'src/slack/common/views/admin-tab-navigation.view';

export class AdminPanelView {
  public static getPanelBlocks(
    tabActionId: AdminNavigationActionId,
  ): AnyBlock[] {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*⚙ Admin Panel*\nManage users, teams, vacation requests and policies.',
        },
      },
      ...AdminTabNavigation.getNavigationBlocks(tabActionId),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '_Tip: Configure different vacation rules for each team._',
          },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: ' ' } },
      { type: 'divider' },
    ];
  }
}
