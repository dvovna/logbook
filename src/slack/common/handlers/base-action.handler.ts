import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { ISlackInteractionHandler } from '@modules/slack/common/handlers/slack-interaction.handler';

export type ActionMapType = Record<
  string,
  (
    payload: ISlackBlockActionPayload,
    user: IUserViewModel,
  ) => Promise<unknown> | unknown
>;

export abstract class BaseActionHandler implements ISlackInteractionHandler {
  protected abstract actionMap: ActionMapType;
  protected readonly globalActionMap: ActionMapType = {};

  public handle(payload: ISlackBlockActionPayload, user: IUserViewModel) {
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
