import { View } from '@slack/types/dist/views';
import { SlackJson } from './block-kit';
import { TAB_NOTICE_BLOCK_ID } from '@modules/slack/common/types/tab-params.types';
import { TIMESHEET_ROW_BLOCK_ID } from '@modules/slack/tabs/time-tracking/views/timesheet-form-modal.view';

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

export const timesheetStatusOf = (view: View): string | undefined =>
  blocksOf(view)
    .filter((block) => block.type === 'context')
    .map((block) => block.elements[0]?.text as string)
    .find((text) => text?.startsWith('🕒 Week of'));

export interface ITimesheetFormRow {
  // 'Website · Acme'
  project: string;
  // An input as its day and its hours, 'Wed 17 [1.5]' ('Wed 17 []' when
  // empty); a cell that can't be changed there as its text, 'Wed 17 · 2h ·
  // submitted'.
  cells: string[];
}

export const timesheetFormRows = (view: View): ITimesheetFormRow[] => {
  const rows: ITimesheetFormRow[] = [];
  let row: ITimesheetFormRow | undefined;

  for (const block of blocksOf(view)) {
    if (block.block_id?.startsWith(`${TIMESHEET_ROW_BLOCK_ID}:`)) {
      row = { project: block.text.text.replace(/\*/g, ''), cells: [] };
      rows.push(row);
    } else if (
      row &&
      block.type === 'input' &&
      block.element.type === 'plain_text_input'
    ) {
      row.cells.push(
        `${block.label.text} [${block.element.initial_value ?? ''}]`,
      );
    } else if (row && block.type === 'context') {
      row.cells.push(block.elements[0].text);
    } else {
      row = undefined;
    }
  }

  return rows;
};
