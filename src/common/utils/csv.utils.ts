// CSV files people open in a spreadsheet (RFC 4180: commas, CRLF line ends,
// quotes around a field that has a comma, a quote or a line break).

// Excel reads a CSV as UTF-8 only after this mark; without it, names in
// other alphabets come out garbled.
const BYTE_ORDER_MARK = '\uFEFF';

// A spreadsheet runs a cell that starts with one of these as a formula, so
// text people typed ("=HYPERLINK(...)") could run when the file is opened.
const FORMULA_START = /^[=+\-@\t\r]/;

// Text people typed, made safe to open: a leading ' keeps a spreadsheet from
// reading it as a formula. Numbers the app formats need no such care.
export const csvText = (value: string | null | undefined) => {
  const text = value ?? '';

  return FORMULA_START.test(text) ? `'${text}` : text;
};

// The text csvText wrote, read back: a spreadsheet keeps the ' it added.
export const fromCsvText = (text: string) =>
  text.startsWith("'") && FORMULA_START.test(text.slice(1))
    ? text.slice(1)
    : text;

const csvField = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

// Lines of a file, each ended by a line break: what toCsv writes after the
// mark, so that a big file can be written a part at a time.
export const csvLines = (rows: string[][]) =>
  rows.map((row) => `${row.map(csvField).join(',')}\r\n`).join('');

// A file's beginning: the byte order mark and the header line.
export const csvStart = (header: string[]) =>
  BYTE_ORDER_MARK + csvLines([header]);

export const toCsv = ([header, ...rows]: string[][]) =>
  csvStart(header) + csvLines(rows);
