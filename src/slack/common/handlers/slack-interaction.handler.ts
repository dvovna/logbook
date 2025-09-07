import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

export interface ISlackInteractionHandler {
  handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<void> | void;
}
