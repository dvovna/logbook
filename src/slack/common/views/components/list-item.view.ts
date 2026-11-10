import { AnyBlock, Button } from '@slack/web-api';
import { SectionBlockAccessory } from '@slack/types/dist/block-kit/blocks';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { Divider } from '@modules/slack/common/views/components/separator';

export interface IListItemParams {
  // Plain text, e.g. a name: escaped and shown in bold.
  title: string;
  // "Label: value" lines in mrkdwn, already escaped where they hold what
  // people typed. Empty ones (false, null, undefined, '') are left out.
  details?: (string | false | null | undefined)[];
  // Usually the item's ⋯ menu; one with a single option shows as a button.
  accessory?: SectionBlockAccessory;
  // Shown under the item, e.g. Approve and Reject.
  buttons?: Button[];
}

// A ⋯ menu with one option hides it a click deeper: show it as a button.
// It keeps the menu's action_id and the option's value, which withMenuAction
// reads from either.
const asButtonIfOneOption = (
  accessory: SectionBlockAccessory,
): SectionBlockAccessory => {
  if (accessory.type !== 'overflow' || accessory.options.length !== 1) {
    return accessory;
  }

  const [option] = accessory.options;

  return {
    type: 'button',
    text: { type: 'plain_text', text: option.text.text },
    action_id: accessory.action_id,
    value: option.value,
  };
};

// One item of a list in a tab: its title, its details and its actions, then
// a divider. Every list renders its items this way, so they look alike.
export class ListItem {
  public static getBlocks({
    title,
    details = [],
    accessory,
    buttons,
  }: IListItemParams): AnyBlock[] {
    const text = [`*${escapeMrkdwn(title)}*`, ...details.filter(Boolean)].join(
      '\n',
    );

    const shownAccessory = accessory && asButtonIfOneOption(accessory);
    const blocks: AnyBlock[] = [
      {
        type: 'section',
        fields: [{ type: 'mrkdwn', text }],
        ...(shownAccessory ? { accessory: shownAccessory } : {}),
      },
    ];

    if (buttons?.length) {
      blocks.push({ type: 'actions', elements: buttons });
    }

    return [...blocks, ...Divider.getBlocks()];
  }
}

// "Label: value", or nothing when there is no value to show.
export const detail = (
  label: string,
  value: string | number | null | undefined,
) =>
  value === null || value === undefined || value === ''
    ? null
    : `${label}: ${value}`;
