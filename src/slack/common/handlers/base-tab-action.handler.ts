import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import {
  SCREENS,
  ScreenId,
  screenOfAction,
} from '@modules/slack/common/navigation/screens';

// The handler of a tab: besides its own actions, it opens every screen a
// navigation button names (ScreenHeader), whatever screen the button is on.
export abstract class BaseTabActionHandler extends BaseActionHandler {
  public constructor(
    protected readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  protected readonly globalActionMap: ActionMapType = Object.fromEntries(
    Object.values(NavigationActionId).map((actionId) => [
      actionId,
      (_payload: ISlackInteractionPayload, user: IUserViewModel) =>
        this.openScreen(actionId, user),
    ]),
  );

  private openScreen(actionId: NavigationActionId, user: IUserViewModel) {
    const screenId = screenOfAction(actionId, user.role);

    // No Settings screen for this role: BaseTabService sends it Home.
    const { tabId, metadata } = SCREENS[screenId ?? ScreenId.Home];

    this.tabNavigationService.navigate(tabId, { user, metadata });
  }
}
