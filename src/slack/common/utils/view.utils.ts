import { IOption } from 'src/slack/common/types/option.interface';
import { PlainTextOption } from '@slack/web-api';
import { ISlackBlockActionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ButtonAction } from '@slack/bolt';

export const toPlainTextOption = ({ id, name }: IOption): PlainTextOption => {
  return {
    text: {
      type: 'plain_text',
      text: name,
    },
    value: id,
  };
};

export function withButtonAction<ActionType = unknown>(
  handler: (
    actionType: ActionType,
    value: string,
    user: IUserViewModel,
  ) => unknown,
) {
  return (payload: ISlackBlockActionPayload, user: IUserViewModel) => {
    const buttonValue = (payload.actions[0] as ButtonAction).value;

    const [action, value] = buttonValue?.split(':') || [];

    if (!action || !value) {
      throw new Error('Invalid button value format');
    }

    return handler(action as ActionType, value, user);
  };
}
