import { KnownBlock } from '@slack/types';

// Slack takes at most 3000 characters in a section and 50 blocks in a
// message.
const MAX_SECTION_CHARACTERS = 3000;
const MAX_MESSAGE_BLOCKS = 50;
const MAX_LISTED = 10;
// Room for the "…and N more" line.
const MORE_ROOM = 30;

export const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

export const section = (text: string): KnownBlock => ({
  type: 'section',
  text: { type: 'mrkdwn', text },
});

export const context = (text: string): KnownBlock => ({
  type: 'context',
  elements: [{ type: 'mrkdwn', text }],
});

// A title and its bullets: at most 10, fewer when they would not fit in one
// section, and what is left out is counted.
export function listSection(
  title: string,
  items: string[],
  intro?: string,
): KnownBlock {
  const head = [title, ...(intro ? [intro] : [])].join('\n');
  const lines: string[] = [];
  let length = head.length;

  for (const item of items.slice(0, MAX_LISTED)) {
    const line = `• ${item}`;
    if (length + line.length + MORE_ROOM > MAX_SECTION_CHARACTERS) break;
    lines.push(line);
    length += line.length + 1;
  }

  const more = items.length - lines.length;

  return section(
    [head, ...lines, ...(more > 0 ? [`…and ${more} more`] : [])].join('\n'),
  );
}

// A title and every one of its bullets, in as many sections as they take
// (messageBlocks).
export interface IFullList {
  title: string;
  items: string[];
  intro?: string;
}

export type IMessagePart = KnownBlock | IFullList;

export const fullList = (
  title: string,
  items: string[],
  intro?: string,
): IFullList => ({ title, items, ...(intro ? { intro } : {}) });

const isList = (part: IMessagePart): part is IFullList => 'items' in part;

// The blocks of a message whose lists take as many sections as they need,
// within the blocks Slack allows: each list in turn gets what the other
// parts leave, less one block for each list after it. Only a list that runs
// out of blocks ends with "…and N more".
export function messageBlocks(parts: IMessagePart[]): KnownBlock[] {
  let listsAfter = parts.filter(isList).length;
  let left = MAX_MESSAGE_BLOCKS - (parts.length - listsAfter);

  return parts.flatMap((part) => {
    if (!isList(part)) {
      return [part];
    }

    listsAfter--;
    const blocks = listSections(part, Math.max(1, left - listsAfter));
    left -= blocks.length;

    return blocks;
  });
}

function listSections(
  { title, items, intro }: IFullList,
  maxSections: number,
): KnownBlock[] {
  const sections = [[title, ...(intro ? [intro] : [])]];
  let length = sections[0].join('\n').length;
  let listed = 0;

  for (const [index, item] of items.entries()) {
    // A line longer than a section is cut: only a list of many dates runs
    // that long, and it ends with them.
    const line = `• ${clip(item, MAX_SECTION_CHARACTERS - MORE_ROOM - 2)}`;
    const onLast = sections.length === maxSections;
    // The last section keeps room to count what doesn't fit, unless this is
    // the last line.
    const room =
      MAX_SECTION_CHARACTERS -
      (onLast && index < items.length - 1 ? MORE_ROOM : 0);

    if (length + 1 + line.length > room) {
      if (onLast) {
        break;
      }

      sections.push([line]);
      length = line.length;
    } else {
      sections[sections.length - 1].push(line);
      length += 1 + line.length;
    }

    listed++;
  }

  const more = items.length - listed;

  if (more > 0) {
    sections[sections.length - 1].push(`…and ${more} more`);
  }

  return sections.map((lines) => section(lines.join('\n')));
}
