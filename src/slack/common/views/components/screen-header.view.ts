import {
  ActionsBlockElement,
  AnyBlock,
  Button,
  PlainTextOption,
  StaticSelect,
} from '@slack/web-api';
import UserRole from '@common/enums/user-role.enum';
import {
  menuGroupsFor,
  navigationScreensFor,
  rootOf,
  SCREENS,
  ScreenId,
} from '@modules/slack/common/navigation/screens';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';

export const HEADER_BLOCK_IDS = {
  navigation: 'navigation',
  back: 'back_navigation',
};

// What the More menu says while none of its screens is open.
export const MENU_PLACEHOLDER = '☰ More';

export interface IScreenHeaderParams {
  screenId: ScreenId;
  role: UserRole;
  // What waits for the viewer's decision, on the Approvals button.
  approvalsCount?: number;
  // The workspace has a project. Without one the screens about time are
  // left out, but the one on show.
  tracksTime?: boolean;
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

const menuOption = (screenId: ScreenId): PlainTextOption => ({
  text: { type: 'plain_text', text: SCREENS[screenId].title, emoji: true },
  value: SCREENS[screenId].actionId!,
});

// The top of every screen, from SCREENS: one row of the main screens'
// buttons and a More menu with the rest, which shows the screen open from
// it; then Back on a screen opened from another one.
export class ScreenHeader {
  public static getBlocks({
    screenId,
    role,
    approvalsCount,
    tracksTime = true,
  }: IScreenHeaderParams): AnyBlock[] {
    const root = rootOf(screenId);
    const shown = (id: ScreenId) =>
      tracksTime || !SCREENS[id].aboutTime || id === root;
    const blocks: AnyBlock[] = [
      {
        type: 'actions',
        block_id: HEADER_BLOCK_IDS.navigation,
        elements: this.getNavigation(root, role, shown, approvalsCount),
      },
    ];

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

  private static getNavigation(
    root: ScreenId,
    role: UserRole,
    shown: (id: ScreenId) => boolean,
    approvalsCount?: number,
  ): ActionsBlockElement[] {
    const buttonOf = (id: ScreenId) => {
      const count =
        id === ScreenId.Approvals && approvalsCount
          ? ` (${approvalsCount})`
          : '';

      return button(
        `${SCREENS[id].title}${count}`,
        SCREENS[id].actionId!,
        id === root,
      );
    };
    const groups = menuGroupsFor(role)
      .map(({ group, screens }) => ({ group, screens: screens.filter(shown) }))
      .filter(({ screens }) => screens.length);
    const menu = groups.flatMap(({ screens }) => screens);

    // A menu of one screen would hide it a click deeper: a button it is.
    return [
      ...navigationScreensFor(role).filter(shown).map(buttonOf),
      ...(menu.length > 1
        ? [this.getMenu(groups, menu, root)]
        : menu.map(buttonOf)),
    ];
  }

  private static getMenu(
    groups: ReturnType<typeof menuGroupsFor>,
    screens: ScreenId[],
    root: ScreenId,
  ): StaticSelect {
    return {
      type: 'static_select',
      action_id: NavigationActionId.Menu,
      placeholder: { type: 'plain_text', text: MENU_PLACEHOLDER, emoji: true },
      ...(groups.length > 1
        ? {
            option_groups: groups.map(({ group, screens: inGroup }) => ({
              label: { type: 'plain_text' as const, text: group },
              options: inGroup.map(menuOption),
            })),
          }
        : { options: screens.map(menuOption) }),
      ...(screens.includes(root) ? { initial_option: menuOption(root) } : {}),
    };
  }
}
