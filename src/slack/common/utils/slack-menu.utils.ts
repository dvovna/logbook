import type { OverflowAction } from '@slack/bolt';
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
    const value = (payload.actions[0] as OverflowAction).selected_option?.value;

    if (!value) {
      logger.warn('MenuAction triggered without selected_option');
      return;
    }

    const [actionType, entityId] = value.split(':');

    await handler(actionType as ActionType, entityId, payload, ...args);
  };
}
