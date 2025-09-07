import { OverflowAction } from '@slack/bolt';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';

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
) {
  return async (payload: ISlackInteractionPayload, ...args: Arguments) => {
    const value = (payload.actions[0] as OverflowAction).selected_option?.value;

    if (!value) {
      console.warn('MenuAction triggered without selected_option');
      return;
    }

    const [actionType, entityId] = value.split(':');

    await handler(actionType as ActionType, entityId, payload, ...args);
  };
}
