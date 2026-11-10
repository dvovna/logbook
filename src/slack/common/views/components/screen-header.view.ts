import { splitIntoRows } from '@modules/slack/common/views/components/actions-rows';
import { AnyBlock, Button } from '@slack/web-api';
import UserRole from '@common/enums/user-role.enum';
import {
  canOpenScreen,
  NAVIGATION_ROW,
  rootOf,
  SCREENS,
  ScreenId,
  SETTINGS_TITLE,
  settingsScreensFor,
} from '@modules/slack/common/navigation/screens';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';

export const HEADER_BLOCK_IDS = {
  navigation: 'navigation',
  // The navigation's second row, when it has more buttons than one row shows.
  navigationMore: 'navigation_more',
  settings: 'settings_navigation',
  back: 'back_navigation',
};

export interface IScreenHeaderParams {
  screenId: ScreenId;
  role: UserRole;
  // What waits for the viewer's decision, on the Approvals button.
  approvalsCount?: number;
}

const button = (
  text: string,
  actionId: NavigationActionId,
  active: boolean,
): Button => ({
  type: 'button',
  text: { type: 'plain_text', text, emoji: true },
  action_id: actionId,
  ...(active ? { style: 'primary' as const } : {}),
});

// The top of every screen, from SCREENS: the navigation row, the Settings
// row on a Settings screen, and Back on a screen opened from another one.
export class ScreenHeader {
  public static getBlocks({
    screenId,
    role,
    approvalsCount,
  }: IScreenHeaderParams): AnyBlock[] {
    const root = rootOf(screenId);
    const inSettings = !!SCREENS[root].inSettings;
    const navigation = this.getNavigationButtons(root, inSettings, role, {
      approvalsCount,
    });
    // At most two rows: the navigation has seven buttons at most.
    const blocks: AnyBlock[] = splitIntoRows(navigation).map((elements, i) => ({
      type: 'actions',
      block_id: i
        ? HEADER_BLOCK_IDS.navigationMore
        : HEADER_BLOCK_IDS.navigation,
      elements,
    }));

    if (inSettings) {
      blocks.push({
        type: 'actions',
        block_id: HEADER_BLOCK_IDS.settings,
        elements: settingsScreensFor(role).map((id) =>
          button(SCREENS[id].title, SCREENS[id].actionId!, id === root),
        ),
      });
    }

    const parent = SCREENS[screenId].parent;
    const parentActionId = parent && SCREENS[parent].actionId;

    if (parentActionId) {
      blocks.push({
        type: 'actions',
        block_id: HEADER_BLOCK_IDS.back,
        elements: [
          button(`⬅️ Back to ${SCREENS[parent].title}`, parentActionId, false),
        ],
      });
    }

    return blocks;
  }

  private static getNavigationButtons(
    root: ScreenId,
    inSettings: boolean,
    role: UserRole,
    { approvalsCount }: { approvalsCount?: number },
  ): Button[] {
    return NAVIGATION_ROW.flatMap((item) => {
      if (item === NavigationActionId.Settings) {
        return settingsScreensFor(role).length
          ? [button(SETTINGS_TITLE, item, inSettings)]
          : [];
      }

      if (!canOpenScreen(item, role)) {
        return [];
      }

      const { title, actionId } = SCREENS[item];
      const count =
        item === ScreenId.Approvals && approvalsCount
          ? ` (${approvalsCount})`
          : '';

      return [button(`${title}${count}`, actionId!, item === root)];
    });
  }
}
