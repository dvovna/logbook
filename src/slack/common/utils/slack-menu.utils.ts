import type { ButtonAction, OverflowAction } from '@slack/bolt';
import {
  ISlackBlockActionPayload,
  ISlackInteractionPayload,
} from '@modules/slack/common/types/slack-interaction-payload.interface';
import { Logger } from '@nestjs/common';

export function withMenuAction<
  ActionType extends string,
  Arguments extends unknown[],
>(
  handler: (
    actionType: ActionType,
    entityId: string,
    payload: ISlackInteractionPayload,
    ...args: Arguments
  ) => Promise<void>,
  logger: Logger,
) {
  return async (payload: ISlackBlockActionPayload, ...args: Arguments) => {
    // A menu with one option is shown as a button (ListItem).
    const action = payload.actions[0] as OverflowAction | ButtonAction;
    const value =
      'selected_option' in action
        ? action.selected_option?.value
        : action.value;

    if (!value) {
      logger.warn('MenuAction triggered without selected_option');
      return;
    }

    const [actionType, entityId] = value.split(':');

    await handler(actionType as ActionType, entityId, payload, ...args);
  };
}
