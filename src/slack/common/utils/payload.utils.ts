import { ISlackBlockActionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import type {
  CheckboxesAction,
  ExternalSelectAction,
  StaticSelectAction,
} from '@slack/bolt/dist/types/actions/block-action';
import { IOption } from '@common/types/option.interface';

export const getCheckboxActionValues = (payload: ISlackBlockActionPayload) => {
  const action = payload.actions[0] as CheckboxesAction;

  return action.selected_options.map((option) => option.value);
};

export const getSelectActionValue = (
  payload: ISlackBlockActionPayload,
): IOption | undefined => {
  const action = payload.actions[0] as
    StaticSelectAction | ExternalSelectAction;

  if (!action.selected_option) {
    return;
  }

  return {
    id: action.selected_option.value || '',
    name: action.selected_option.text.text || '',
  };
};
