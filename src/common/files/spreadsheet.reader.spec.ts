import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import {
  cellAt,
  columnsOf,
  normalizeHeader,
  readSpreadsheet,
} from '@common/files/spreadsheet.reader';

const csv = (text: string, name = 'a.csv') =>
  readSpreadsheet(Buffer.from(text), name);

const workbookBuffer = async (workbook: Workbook) =>
  Buffer.from(await workbook.xlsx.writeBuffer());

describe('readSpreadsheet', () => {
  it('reads a comma CSV with trimmed cells and row numbers', async () => {
    expect(await csv('Name,Email\nAda Lovelace, ada@example.test \n')).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 2, cells: ['Ada Lovelace', 'ada@example.test'] },
    ]);
  });

  it('reads a CSV that Excel saved: byte order mark, semicolons, CRLF, empty rows', async () => {
    const text = '﻿Name;Email\r\nAnna;anna@x.test\r\n;\r\n;;\r\n';

    expect(await csv(text)).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 2, cells: ['Anna', 'anna@x.test'] },
    ]);
  });

  it('counts delimiters outside quotes when it picks one', async () => {
    expect(await csv('Name;Email;"Notes, a, b, c"\nAda;a@x.test;x')).toEqual([
      { row: 1, cells: ['Name', 'Email', 'Notes, a, b, c'] },
      { row: 2, cells: ['Ada', 'a@x.test', 'x'] },
    ]);
  });

  it('numbers the lines of a CRLF CSV with a quoted multi-line cell', async () => {
    const text = 'Name,Email\r\n"Ada\r\nL.",a@x.test\r\nBob,b@x.test\r\n';

    expect(await csv(text)).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 2, cells: ['Ada\nL.', 'a@x.test'] },
      { row: 4, cells: ['Bob', 'b@x.test'] },
    ]);
  });

  it('numbers each record by the line it starts on, whatever blank lines come before it', async () => {
    const text = 'Name,Email\n\nAda,a@x.test\n\n\nBob,b@x.test\n';

    expect(await csv(text)).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 3, cells: ['Ada', 'a@x.test'] },
      { row: 6, cells: ['Bob', 'b@x.test'] },
    ]);
  });

  it('numbers records after blank lines with CRLF and a multi-line quoted cell', async () => {
    const text =
      'Name,Email\r\n\r\n\r\n"Ada\r\nL.",a@x.test\r\n\r\nBob,b@x.test';

    expect(await csv(text)).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 4, cells: ['Ada\nL.', 'a@x.test'] },
      { row: 7, cells: ['Bob', 'b@x.test'] },
    ]);
  });

  it('reads the first sheet of an xlsx, whatever the file is called', async () => {
    const workbook = new Workbook();
    workbook.addWorksheet('First').addRows([
      ['Name', 'Email'],
      ['Ada', { text: 'ada@x.test', hyperlink: 'mailto:ada@x.test' }],
    ]);
    workbook.addWorksheet('Other').addRow(['x', 'y']);
    const content = await workbookBuffer(workbook);
    const expected = [
      { row: 1, cells: ['Name', 'Email'] },
      { row: 2, cells: ['Ada', 'ada@x.test'] },
    ];

    expect(await readSpreadsheet(content, 'a.xlsx')).toEqual(expected);
    expect(await readSpreadsheet(content, 'renamed.bin')).toEqual(expected);
  });

  it('keeps the sheet row number after a blank row and reads formula and rich text cells as text', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Team');
    sheet.addRow(['Name', 'Team']);
    sheet.addRow([
      { richText: [{ text: 'Ada ' }, { text: 'L.', font: { bold: true } }] },
      { formula: '"Plat"&"form"', result: 'Platform' },
    ]);
    sheet.getRow(4).values = ['Bob', 'Design'];

    expect(
      await readSpreadsheet(await workbookBuffer(workbook), 'a.xlsx'),
    ).toEqual([
      { row: 1, cells: ['Name', 'Team'] },
      { row: 2, cells: ['Ada L.', 'Platform'] },
      { row: 4, cells: ['Bob', 'Design'] },
    ]);
  });

  it('drops an Excel row whose cells are all empty', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Team');
    sheet.addRow(['Name', 'Email']);
    sheet.addRow(['', '']);
    sheet.addRow(['Ada', 'ada@x.test']);

    expect(
      await readSpreadsheet(await workbookBuffer(workbook), 'a.xlsx'),
    ).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 3, cells: ['Ada', 'ada@x.test'] },
    ]);
  });

  it('reads an Excel date cell as an ISO timestamp of that day', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Days');
    sheet.addRow(['Name', 'Day']);
    sheet.addRow(['Anna', new Date(Date.UTC(2026, 4, 4))]);

    const lines = await readSpreadsheet(
      await workbookBuffer(workbook),
      'a.xlsx',
    );

    expect(lines[1].cells[1]).toBe('2026-05-04T00:00:00.000Z');
  });

  it('returns no lines for an empty file', async () => {
    expect(await csv('')).toEqual([]);
  });

  it("refuses a file that can't be read", async () => {
    const unreadable = new BadRequestException(
      "The file can't be read: save it as CSV or Excel and send it again.",
    );

    await expect(csv('Email,Team\n"ada@x.test,Platform')).rejects.toEqual(
      unreadable,
    );
    await expect(
      readSpreadsheet(Buffer.from('PK not a workbook'), 'a.xlsx'),
    ).rejects.toEqual(unreadable);
  });

  it('refuses a CSV that is not UTF-8', async () => {
    // "Zoë" in Windows-1252, as Excel's plain "CSV" writes it.
    const content = Buffer.concat([
      Buffer.from('Name,Email\nZo'),
      Buffer.from([0xeb]),
      Buffer.from(',zoe@x.test\n'),
    ]);

    await expect(readSpreadsheet(content, 'a.csv')).rejects.toEqual(
      new BadRequestException(
        'The file isn\'t saved as UTF-8: save it as "CSV UTF-8" or as an Excel file and send it again.',
      ),
    );
    expect(await csv('Name,Email\nZoë,zoe@x.test')).toEqual([
      { row: 1, cells: ['Name', 'Email'] },
      { row: 2, cells: ['Zoë', 'zoe@x.test'] },
    ]);
  });
});

describe('normalizeHeader', () => {
  it('removes whitespace and lower-cases', () => {
    expect(normalizeHeader(' Team  Lead ')).toBe('teamlead');
    expect(normalizeHeader('E-mail')).toBe('e-mail');
  });
});

describe('columnsOf', () => {
  const columnOfHeader = new Map<string, 'email' | 'team'>([
    ['email', 'email'],
    ['team', 'team'],
  ]);

  it('maps known headers to their index and the first match wins', () => {
    const header = { row: 1, cells: ['Name', ' TEAM', 'Email', 'Team'] };

    expect(columnsOf(header, columnOfHeader)).toEqual(
      new Map([
        ['team', 1],
        ['email', 2],
      ]),
    );
  });

  it('is empty without a header', () => {
    expect(columnsOf(undefined, columnOfHeader).size).toBe(0);
  });
});

describe('cellAt', () => {
  const line = { row: 2, cells: [" ' =Ann ", 'x'] };

  it('trims and reads back text the CSV writer protected', () => {
    expect(cellAt({ row: 2, cells: ["'=Ann "] }, 0)).toBe('=Ann');
    expect(cellAt(line, 1)).toBe('x');
  });

  it('is empty for no column or a missing cell', () => {
    expect(cellAt(line, undefined)).toBe('');
    expect(cellAt(line, 5)).toBe('');
  });
});
