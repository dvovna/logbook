import { View } from '@slack/types/dist/views';
import { SlackJson } from './block-kit';
import { TAB_NOTICE_BLOCK_ID } from '@modules/slack/common/types/tab-params.types';

// Reads App Home tabs the way a user reads them, so that tests compare
// values instead of searching the view's JSON (where "Review" also matches
// the tab's title).

export interface IListItem {
  // The bold first line: a client's, project's or person's name.
  title: string;
  // The "Key: value" lines, e.g. { Client: 'Acme', Status: 'Draft' }.
  fields: Record<string, string>;
  // What the item's menu offers (or the one button that stands for a menu
  // with one option): the action of each option, e.g.
  // ['edit_time_entry', 'delete_time_entry'].
  menu: string[];
  // Their labels, e.g. ['Edit', 'Delete'].
  menuLabels: string[];
  // The action_ids of the buttons right under the item (Approve, Reject).
  buttons: string[];
  // The id the menu or the buttons act on.
  id?: string;
}

const blocksOf = (view: View | { blocks?: unknown[] }) =>
  (view.blocks ?? []) as SlackJson[];

const parseFields = (texts: string[]) => {
  const [first = '', ...rest] = texts.join('\n').split('\n');
  const fields: Record<string, string> = {};

  for (const line of rest) {
    for (const part of line.split(' · ')) {
      const match = part.replace(/\*/g, '').match(/^([^:]+):\s*(.*)$/);

      if (match) {
        fields[match[1].trim()] = match[2].trim();
      }
    }
  }

  return { title: first.replace(/^\*(.*)\*$/, '$1'), fields };
};

// The items of the list in a tab: every section made of fields (clients,
// projects, time entries, entries waiting for approval).
export const listItems = (view: View): IListItem[] => {
  const blocks = blocksOf(view);

  return blocks.flatMap((block, i) => {
    if (block.type !== 'section' || !block.fields?.length) {
      return [];
    }

    const { title, fields } = parseFields(
      block.fields.map((field: SlackJson) => field.text),
    );
    // A menu with one option shows as a button: still the item's menu.
    const menuOptions: SlackJson[] =
      block.accessory?.type === 'button'
        ? [block.accessory]
        : (block.accessory?.options ?? []);
    const menuValues: string[] = menuOptions.map((option) => option.value);
    const next = blocks[i + 1];
    const buttons: SlackJson[] =
      next?.type === 'actions' ? (next.elements ?? []) : [];

    return [
      {
        title,
        fields,
        menu: menuValues.map((value) => value.split(':')[0]),
        menuLabels: menuOptions.map((option) => option.text.text),
        buttons: buttons.map((button) => button.action_id),
        id: menuValues[0]?.split(':')[1] ?? buttons[0]?.value,
      },
    ];
  });
};

export const titlesOf = (view: View) =>
  listItems(view).map(({ title }) => title);

// The texts of the sections that are not list items, e.g. "Today: *2h*".
export const sectionTexts = (view: View): string[] =>
  blocksOf(view)
    .filter((block) => block.type === 'section' && block.text)
    .map((block) => block.text.text);

// The action_ids of every interactive element: buttons, menus, selects. Of a
// view, or of a message the app sent.
export const actionIdsOf = (view: View | { blocks?: unknown[] }): string[] =>
  blocksOf(view).flatMap((block) =>
    [
      ...(block.elements ?? []),
      ...(block.accessory ? [block.accessory] : []),
      ...(block.element ? [block.element] : []),
    ]
      .map((element: SlackJson) => element.action_id)
      .filter(Boolean),
  );

// The line under a list: "3 in total", or "11–20 of 23" when it has pages.
export const listCount = (view: View): string => {
  const text = blocksOf(view)
    .filter((block) => block.type === 'context')
    .flatMap((block) =>
      block.elements.map((element: SlackJson) => element.text),
    )
    .find((line: string) => /^(\d+ in total|\d+–\d+ of \d+)$/.test(line));

  if (!text) {
    throw new Error('The view has no count under its list');
  }

  return text;
};

// The number of items of a list, on all its pages.
export const totalCount = (view: View): number =>
  Number(listCount(view).match(/(\d+)(?: in total)?$/)![1]);

// What the tab says just happened, after a form closed (IPublishBaseParams
// notice), e.g. "✅ Client Acme created.".
export const noticeOf = (view: View): string | undefined =>
  blocksOf(view).find((block) => block.block_id === TAB_NOTICE_BLOCK_ID)
    ?.elements[0].text;

// The day lines of a list grouped by day: "*Wed, 17 Jun 2026* · 2h 30m".
export const dayLines = (view: View): string[] =>
  blocksOf(view)
    .filter((block) => block.type === 'context')
    .map((block) => block.elements[0]?.text ?? '')
    .filter((text: string) => /^\*\w{3}, /.test(text));

// The cells of the view's table, row by row, header first.
export const tableRows = (view: View): string[][] =>
  (blocksOf(view).find((block) => block.type === 'table')?.rows ?? []).map(
    (row: SlackJson[]) => row.map((cell) => cell.text),
  );

// The error a modal shows after a failed submit (getGeneralErrorBlock).
export const modalError = (view: View): string | undefined =>
  sectionTexts(view)
    .find((text) => text.startsWith(':warning: '))
    ?.replace(':warning: ', '');

// The label of the button `actionId`, when the view has one.
export const buttonText = (view: View, actionId: string): string | undefined =>
  blocksOf(view)
    .flatMap((block) => [
      ...(block.elements ?? []),
      ...(block.accessory ? [block.accessory] : []),
    ])
    .find(
      (element: SlackJson) =>
        element.type === 'button' && element.action_id === actionId,
    )?.text.text;
