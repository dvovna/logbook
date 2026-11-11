import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { CellValue, Workbook } from 'exceljs';
import { TEAM_FILE_HEADERS } from 'src/team-file/constants/team-file-headers';
import { MAX_TEAM_FILE_ROWS } from 'src/team-file/constants/team-file-limits';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';

type Column = 'name' | 'email' | 'team' | 'lead';

const normalize = (header: string) => header.replace(/\s/g, '').toLowerCase();

const COLUMN_OF_HEADER = new Map<string, Column>(
  TEAM_FILE_HEADERS.map((header, i) => [
    normalize(header),
    (['name', 'email', 'team', 'lead'] as const)[i],
  ]),
);

const BYTE_ORDER_MARK = '﻿';

// Reads a team file, a CSV or an Excel workbook, into rows. Null when its
// header has no Email and Team columns, i.e. it is not a team file.
export const parseTeamFile = async (
  content: Buffer,
  fileName: string,
): Promise<ITeamFileRow[] | null> => {
  const isExcel =
    fileName.toLowerCase().endsWith('.xlsx') ||
    content.subarray(0, 2).toString('latin1') === 'PK';
  const lines = isExcel ? await readExcel(content) : readCsv(content);

  return lines && toRows(lines);
};

// Each line with its number in the file.
type Line = { row: number; cells: string[] };

const readCsv = (content: Buffer): Line[] => {
  const text = content.toString('utf8').replace(BYTE_ORDER_MARK, '');
  const header = text.split(/\r\n|\n|\r/, 1)[0];
  const semicolons = header.split(';').length;
  const commas = header.split(',').length;

  const records = parse(text, {
    delimiter: semicolons > commas ? ';' : ',',
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    info: true,
  }) as unknown as { record: string[]; info: { lines: number } }[];

  return records.map(({ record, info }) => ({
    row: info.lines,
    cells: record,
  }));
};

const readExcel = async (content: Buffer): Promise<Line[] | null> => {
  const workbook = new Workbook();

  try {
    await workbook.xlsx.load(content as unknown as ArrayBuffer);
  } catch {
    return null;
  }

  const lines: Line[] = [];

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

const toRows = (lines: Line[]): ITeamFileRow[] | null => {
  const [header, ...data] = lines;
  const columns = new Map<Column, number>();

  header?.cells.forEach((cell, index) => {
    const column = COLUMN_OF_HEADER.get(normalize(cell));

    if (column && !columns.has(column)) {
      columns.set(column, index);
    }
  });

  if (!columns.has('email') || !columns.has('team')) {
    return null;
  }

  const rows = data
    .filter(({ cells }) => cells.some((cell) => cell !== ''))
    .map(({ row, cells }) => {
      const at = (column: Column) => {
        const index = columns.get(column);

        return index === undefined ? '' : (cells[index] ?? '').trim();
      };

      return {
        row,
        name: at('name'),
        email: at('email'),
        team: at('team'),
        lead: at('lead'),
      };
    });

  if (rows.length > MAX_TEAM_FILE_ROWS) {
    throw new BadRequestException(
      `A team file can have up to ${MAX_TEAM_FILE_ROWS} rows.`,
    );
  }

  return rows;
};
