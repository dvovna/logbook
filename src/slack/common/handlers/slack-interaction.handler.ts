import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';

export interface ISlackInteractionHandler {
  handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<unknown> | unknown;
}
