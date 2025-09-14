import { CommonViewActionId } from 'src/slack/enums/common-view-action-id.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { ISlackInteractionHandler } from 'src/slack/common/handlers/slack-interaction.handler';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';

export type ActionMapType = Record<
  string,
  (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => Promise<void> | void
>;

export abstract class BaseTabActionHandler implements ISlackInteractionHandler {
  public constructor(
    protected readonly tabNavigationService: TabNavigationService,
  ) {}

  protected abstract actionMap: ActionMapType;

  protected readonly globalActionMap = {
    [CommonViewActionId.BackToHomeTab]: (
      _payload: ISlackInteractionPayload,
      user: IUserViewModel,
    ) => {
      this.tabNavigationService.navigate(TabId.Home, { user });
    },
  };

  public handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    const actionId = payload.actions?.[0]?.action_id;

    if (!actionId) {
      throw new Error('No action id provided');
    }

    const handler = {
      ...this.globalActionMap,
      ...this.actionMap,
    }[actionId];

    if (!handler) {
      throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
    }

    return handler(payload, user);
  }
}
