import { AnyBlock } from '@slack/web-api';

// A table block holds 100 rows and 10000 characters in its cells, and a view
// holds one table.
const MAX_TABLE_ROWS = 100;
const MAX_TABLE_CHARACTERS = 10000;

const lengthOf = (row: string[]) =>
  row.reduce((sum, text) => sum + text.length, 0);

const cell = (text: string) => ({ type: 'raw_text', text });

// The header, as many lines as the table holds, and the footer (a total
// row): the rows of the table, and how many lines were left out.
export const fitTableRows = (
  header: string[],
  lines: string[][],
  footer: string[][] = [],
) => {
  const rows = [header];
  const maxRows = MAX_TABLE_ROWS - footer.length;
  let characters = lengthOf(header) + lengthOf(footer.flat());

  for (const line of lines) {
    if (
      rows.length >= maxRows ||
      characters + lengthOf(line) > MAX_TABLE_CHARACTERS
    ) {
      break;
    }

    rows.push(line);
    characters += lengthOf(line);
  }

  return {
    rows: [...rows, ...footer],
    left: lines.length - (rows.length - 1),
  };
};

// `alignments`: 'left' or 'right' per column; left columns wrap.
export const tableBlock = (
  rows: string[][],
  alignments: ('left' | 'right')[],
): AnyBlock =>
  ({
    type: 'table',
    column_settings: alignments.map((align) =>
      align === 'right' ? { align } : { is_wrapped: true },
    ),
    rows: rows.map((row) => row.map(cell)),
  }) as unknown as AnyBlock;

// "and 12 more lines, in the total" under a table that left lines out.
export const moreLinesBlocks = (left: number, note = ''): AnyBlock[] =>
  left
    ? [
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `_and ${left} more lines${note}_` },
          ],
        },
      ]
    : [];
