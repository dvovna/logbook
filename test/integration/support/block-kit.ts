import { View } from '@slack/types/dist/views';

// Slack payloads and Block Kit JSON, loosely typed on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlackJson = Record<string, any>;

type AnyElement = SlackJson;
type FieldValue = string | string[] | undefined;

export interface IFoundAction {
  blockId: string;
  element: AnyElement;
}

const optionsOf = (element: AnyElement): AnyElement[] => [
  ...(element.options ?? []),
  ...(element.option_groups ?? []).flatMap((group) => group.options),
];

const findOption = (element: AnyElement, value: string) => {
  const option = optionsOf(element).find((option) => option.value === value);

  if (!option) {
    throw new Error(
      `${element.action_id} has no option ${value}; it has ${optionsOf(element)
        .map((option) => option.value)
        .join(', ')}`,
    );
  }

  return option;
};

// What Slack puts in view.state.values for one input element.
const elementState = (element: AnyElement, value: FieldValue) => {
  const { type } = element;

  switch (type) {
    case 'datepicker':
      return { type, selected_date: value ?? null };
    case 'timepicker':
      return { type, selected_time: value ?? null };
    case 'plain_text_input':
    case 'number_input':
    case 'email_text_input':
    case 'url_text_input':
      return { type, value: value ?? null };
    case 'static_select':
      return {
        type,
        selected_option: value ? findOption(element, value as string) : null,
      };
    case 'external_select':
      return {
        type,
        selected_option: value
          ? { text: { type: 'plain_text', text: value }, value }
          : null,
      };
    case 'multi_static_select':
    case 'checkboxes':
      return {
        type,
        selected_options: ((value as string[]) ?? []).map((item) =>
          findOption(element, item),
        ),
      };
    case 'users_select':
      return { type, selected_user: value ?? null };
    case 'multi_users_select':
      return { type, selected_users: value ?? [] };
    default:
      throw new Error(`fillForm does not support ${type} elements`);
  }
};

// Builds view.state.values the way Slack does when the user submits `view`
// with `values` (keyed by action_id). Throws when `values` names a field the
// view does not have, so a renamed field breaks the test instead of passing
// silently.
export const fillForm = (view: View, values: Record<string, FieldValue>) => {
  const state: Record<string, Record<string, unknown>> = {};
  const unused = new Set(Object.keys(values));

  for (const block of view.blocks as AnyElement[]) {
    if (block.type !== 'input') {
      continue;
    }

    const { element } = block;
    unused.delete(element.action_id);

    state[block.block_id] = {
      [element.action_id]: elementState(element, values[element.action_id]),
    };
  }

  if (unused.size) {
    throw new Error(`The form has no inputs for ${[...unused].join(', ')}`);
  }

  return state;
};

// Finds an interactive element in a view or message by its action_id and,
// for buttons, its value.
export const findAction = (
  blocks: AnyElement[],
  actionId: string,
  value?: string,
): IFoundAction => {
  for (const block of blocks) {
    const elements = [
      ...(block.elements ?? []),
      ...(block.accessory ? [block.accessory] : []),
    ];
    const element = elements.find(
      (item) =>
        item.action_id === actionId &&
        (value === undefined || item.type !== 'button' || item.value === value),
    );

    if (element) {
      // Slack makes up a block_id when the app sets none; the app routes
      // block actions by block_id, so that would be a bug worth seeing.
      return { blockId: block.block_id ?? 'slack-generated-id', element };
    }
  }

  throw new Error(`No element with action_id ${actionId} found`);
};

// The `actions[0]` Slack sends when the user clicks/chooses `element`.
export const actionPayload = (
  { blockId, element }: IFoundAction,
  value?: string,
) => {
  const base = {
    type: element.type,
    action_id: element.action_id,
    block_id: blockId,
    action_ts: `${Date.now() / 1000}`,
  };

  switch (element.type) {
    case 'button':
      return { ...base, value: element.value, text: element.text };
    case 'overflow':
    case 'static_select':
      return { ...base, selected_option: findOption(element, value!) };
    default:
      throw new Error(`actionPayload does not support ${element.type}`);
  }
};

// All the text of a message or view, for loose assertions.
export const textOf = (source: { text?: string; blocks?: unknown }) =>
  JSON.stringify([source.text ?? '', source.blocks ?? []]);
