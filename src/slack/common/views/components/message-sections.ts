import { KnownBlock } from '@slack/types';

// Slack takes at most 3000 characters in a section.
const MAX_SECTION_CHARACTERS = 3000;
const MAX_LISTED = 10;

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
    // Leaves room for the "…and N more" line.
    if (length + line.length + 30 > MAX_SECTION_CHARACTERS) break;
    lines.push(line);
    length += line.length + 1;
  }

  const more = items.length - lines.length;

  return section(
    [head, ...lines, ...(more > 0 ? [`…and ${more} more`] : [])].join('\n'),
  );
}
