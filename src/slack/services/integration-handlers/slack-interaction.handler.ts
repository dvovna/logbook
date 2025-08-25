import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ViewResponseAction } from '@slack/bolt/dist/types/view';

export interface ISlackInteractionHandler {
  handle(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ): Promise<void | ViewResponseAction>;
}
