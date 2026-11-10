import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import {
  isNavigationActionId,
  SCREENS,
  ScreenId,
  screenOfAction,
} from '@modules/slack/common/navigation/screens';
import type { StaticSelectAction } from '@slack/bolt';

// The handler of a tab: besides its own actions, it opens every screen a
// navigation button or the More menu names (ScreenHeader), whatever screen
// it is on.
export abstract class BaseTabActionHandler extends BaseActionHandler {
  public constructor(
    protected readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected readonly globalActionMap: ActionMapType = {
    ...Object.fromEntries(
      Object.values(NavigationActionId).map((actionId) => [
        actionId,
        (_payload: ISlackInteractionPayload, user: IUserViewModel) =>
          this.openScreen(actionId, user),
      ]),
    ),
    [NavigationActionId.Menu]: (payload, user) => {
      // The value comes from the client: anything but a screen's action
      // opens Home, and BaseTabService checks the role either way.
      const value = (payload.actions[0] as StaticSelectAction).selected_option
        ?.value;

      return this.openScreen(
        isNavigationActionId(value) ? value : NavigationActionId.Home,
        user,
      );
    },
  };

  private openScreen(actionId: NavigationActionId, user: IUserViewModel) {
    // The menu names screens; a forged menu value naming the menu opens Home.
    const screenId =
      actionId === NavigationActionId.Menu
        ? undefined
        : screenOfAction(actionId, user.role);

    // No Settings screen for this role: BaseTabService sends it Home.
    const { tabId, metadata } = SCREENS[screenId ?? ScreenId.Home];

    this.tabNavigationService.navigate(tabId, { user, metadata });
  }
}
