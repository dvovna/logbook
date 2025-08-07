import { IViewStateValues } from 'src/slack/types/slack-view-state-values.interface';

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

  if (!item || typeof item.value !== 'string') {
    throw new Error(`Missing value for ${blockId}.${actionId}`);
  }

  return item.value;
};

export const getOptionalValue = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const item = getActionItem(values, blockId, actionId);

  return typeof item.value === 'string' ? item?.value : null;
};

export const getSelectedDate = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const item = getActionItem(values, blockId, actionId);

  if (!item || typeof item.selected_date !== 'string') {
    throw new Error(`Missing selected date for ${blockId}.${actionId}`);
  }

  return item.selected_date;
};

export const getSelectedOption = (
  values: IViewStateValues,
  blockId: string,
  actionId: string,
) => {
  const item = getActionItem(values, blockId, actionId);

  if (
    !item ||
    !item.selected_option ||
    typeof item.selected_option.value !== 'string'
  ) {
    throw new Error(`Missing selected option for ${blockId}.${actionId}`);
  }

  return item.selected_option.value;
};
