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
  // Usually the item's ⋯ menu.
  accessory?: SectionBlockAccessory;
  // Shown under the item, e.g. Approve and Reject.
  buttons?: Button[];
}

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

    const blocks: AnyBlock[] = [
      {
        type: 'section',
        fields: [{ type: 'mrkdwn', text }],
        ...(accessory ? { accessory } : {}),
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
