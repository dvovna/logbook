import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { CellValue, Workbook } from 'exceljs';
import { fromCsvText } from '@common/utils/csv.utils';
import { unpackedSize } from '@common/files/zip-size';

// Each line with its number in the file.
export interface ISpreadsheetLine {
  row: number;
  cells: string[];
}

const UNREADABLE_FILE =
  "The file can't be read: save it as CSV or Excel and send it again.";
const TOO_LARGE_UNPACKED =
  'The Excel file holds too much to read. Keep only the sheet with the rows, or save it as CSV, and send it again.';
// A sheet of 5000 rows unpacks to a few megabytes.
const MAX_UNPACKED_BYTES = 10 * 1024 * 1024;
const NOT_UTF8 =
  'The file isn\'t saved as UTF-8: save it as "CSV UTF-8" or as an Excel file and send it again.';

// Excel's plain "CSV" on Windows writes the system's code page, in which
// names with letters beyond ASCII would come out garbled.
const decodeUtf8 = (content: Buffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    throw new BadRequestException(NOT_UTF8);
  }
};

interface ICsvRecord {
  record: string[];
  raw: string;
  info: { lines: number };
}

const readCsv = (content: Buffer): ISpreadsheetLine[] => {
  // One kind of line end, because csv-parse counts a CRLF inside a quoted
  // cell as two lines. The decoder drops a byte order mark.
  const text = decodeUtf8(content).replace(/\r\n?/g, '\n');
  const header = text.split(/\r\n|\n|\r/, 1)[0].replace(/"[^"]*"/g, '');
  const semicolons = header.split(';').length;
  const commas = header.split(',').length;

  let records: ICsvRecord[];

  try {
    records = parse(text, {
      delimiter: semicolons > commas ? ';' : ',',
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      info: true,
      raw: true,
    }) as unknown as ICsvRecord[];
  } catch {
    throw new BadRequestException(UNREADABLE_FILE);
  }

  // `lines` is where the record ends; a row's number is where it starts. The
  // raw text of a record also holds the blank lines before it.
  return records.map(({ record, raw, info }) => ({
    row:
      info.lines -
      (raw.replace(/^\n+/, '').replace(/\n$/, '').match(/\n/g) ?? []).length,
    cells: record,
  }));
};

const readExcel = async (content: Buffer): Promise<ISpreadsheetLine[]> => {
  // The 1 MB a file may have is its packed size.
  const size = unpackedSize(content, MAX_UNPACKED_BYTES);

  if (size !== 'fits') {
    throw new BadRequestException(
      size === 'too-large' ? TOO_LARGE_UNPACKED : UNREADABLE_FILE,
    );
  }

  const workbook = new Workbook();

  try {
    await workbook.xlsx.load(content as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException(UNREADABLE_FILE);
  }

  const lines: ISpreadsheetLine[] = [];

  workbook.worksheets[0]?.eachRow((row, rowNumber) => {
    const cells: string[] = [];

    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cells[column - 1] = textOfCell(cell.value);
    });
    lines.push({ row: rowNumber, cells: Array.from(cells, (c) => c ?? '') });
  });

  return lines;
};

const textOfCell = (value: CellValue): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'object') {
    if ('richText' in value) {
      return value.richText
        .map(({ text }) => text)
        .join('')
        .trim();
    }

    if ('result' in value) {
      return textOfCell(value.result as CellValue);
    }

    if ('text' in value) {
      return textOfCell(value.text as CellValue);
    }

    return '';
  }

  return String(value).trim();
};

export const normalizeHeader = (header: string) =>
  header.replace(/\s/g, '').toLowerCase();

// The first column with a known header wins.
export const columnsOf = <C extends string>(
  header: ISpreadsheetLine | undefined,
  columnOfHeader: Map<string, C>,
): Map<C, number> => {
  const columns = new Map<C, number>();

  header?.cells.forEach((cell, index) => {
    const column = columnOfHeader.get(normalizeHeader(cell));

    if (column && !columns.has(column)) {
      columns.set(column, index);
    }
  });

  return columns;
};

export const cellAt = (line: ISpreadsheetLine, index: number | undefined) =>
  index === undefined
    ? ''
    : fromCsvText((line.cells[index] ?? '').trim()).trim();

// Reads a CSV or an Excel workbook (its first sheet) into lines, leaving out
// those with no text in any cell.
export const readSpreadsheet = async (
  content: Buffer,
  fileName: string,
): Promise<ISpreadsheetLine[]> => {
  const isExcel =
    fileName.toLowerCase().endsWith('.xlsx') ||
    content.subarray(0, 2).toString('latin1') === 'PK';
  const lines = isExcel ? await readExcel(content) : readCsv(content);

  return lines.filter(({ cells }) => cells.some((cell) => cell !== ''));
};
