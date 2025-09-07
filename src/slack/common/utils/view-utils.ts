import { IViewStateValues } from 'src/slack/common/types/slack-view-state-values.interface';
import {
  DatepickerAction,
  StaticSelectAction,
} from '@slack/bolt/dist/types/actions/block-action';
import ViewFieldType from 'src/slack/enums/view-field-type.enum';

interface IFieldPathParams {
  blockId: string;
  actionId: string;
}

export interface ISelectedOption<Value = string> {
  value: Value;
  text: string;
}

const getActionItem = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const block = values[blockId];

  return block?.[actionId];
};

export const getValue = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const item = getActionItem(values, blockId, actionId);

  return item?.value || '';
};

export const getSelectedDate = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const item = getActionItem(values, blockId, actionId) as DatepickerAction;

  return item?.selected_date;
};

export const getSelectedOption = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const item = getActionItem(values, blockId, actionId) as StaticSelectAction;

  return (
    item?.selected_option?.value && {
      value: item.selected_option.value,
      text: item.selected_option.text.text,
    }
  );
};

export const getValueByType = (
  values: IViewStateValues,
  fieldType: ViewFieldType,
  { blockId, actionId }: IFieldPathParams,
): string | ISelectedOption | undefined | null => {
  switch (fieldType) {
    case ViewFieldType.Text:
      return getValue(values, blockId, actionId);
    case ViewFieldType.Select:
      return getSelectedOption(values, blockId, actionId);
    case ViewFieldType.Date:
      return getSelectedDate(values, blockId, actionId);
    default:
      throw new Error(`Unsupported field type: ${fieldType}`);
  }
};
