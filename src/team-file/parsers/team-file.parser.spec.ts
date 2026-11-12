import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';
import { csvText, toCsv } from '@common/utils/csv.utils';
import { readSpreadsheet } from '@common/files/spreadsheet.reader';
import { parseTeamFile } from 'src/team-file/parsers/team-file.parser';

const parse = async (content: Buffer, fileName: string) =>
  parseTeamFile(await readSpreadsheet(content, fileName));

const csv = (text: string, name = 'team-file.csv') =>
  parse(Buffer.from(text), name);

describe('parseTeamFile', () => {
  it('reads a comma CSV', async () => {
    const rows = await csv(
      'Name,Email,Team,Team lead\nAda Lovelace, ada@example.test ,Platform,yes\nBob,bob@example.test,,\n',
    );

    expect(rows).toEqual([
      {
        row: 2,
        name: 'Ada Lovelace',
        email: 'ada@example.test',
        team: 'Platform',
        lead: 'yes',
      },
      { row: 3, name: 'Bob', email: 'bob@example.test', team: '', lead: '' },
    ]);
  });

  it('reads a semicolon CSV with a byte order mark and CRLF line ends', async () => {
    const text =
      '﻿Name;Email;Team;Team lead\r\nAda, L.;ada@example.test;Platform;yes\r\n';

    expect(await csv(text)).toEqual([
      {
        row: 2,
        name: 'Ada, L.',
        email: 'ada@example.test',
        team: 'Platform',
        lead: 'yes',
      },
    ]);
  });

  it('reads the first sheet of an xlsx', async () => {
    const workbook = new Workbook();
    const first = workbook.addWorksheet('Team');
    first.addRow(['Name', 'Email', 'Team', 'Team lead']);
    first.addRow(['Ada', 'ada@example.test', 'Platform', 'yes']);
    first.addRow([
      'Bob',
      { text: 'bob@example.test', hyperlink: 'mailto:bob@example.test' },
      'Design',
      '',
    ]);
    workbook.addWorksheet('Other').addRows([
      ['Email', 'Team'],
      ['x@example.test', 'Nope'],
    ]);
    const content = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(await parse(content, 'team.xlsx')).toEqual([
      {
        row: 2,
        name: 'Ada',
        email: 'ada@example.test',
        team: 'Platform',
        lead: 'yes',
      },
      {
        row: 3,
        name: 'Bob',
        email: 'bob@example.test',
        team: 'Design',
        lead: '',
      },
    ]);
    expect(await parse(content, 'renamed.bin')).toHaveLength(2);
  });

  it('matches headers ignoring case and spaces ("team lead", "E-mail" is not Email)', async () => {
    expect(
      await csv('EMAIL,team,TeamLead\nada@example.test,Platform,x'),
    ).toEqual([
      {
        row: 2,
        name: '',
        email: 'ada@example.test',
        team: 'Platform',
        lead: 'x',
      },
    ]);
    expect(
      await csv(' team lead ,Team, Email\nx,Platform,ada@example.test'),
    ).toEqual([
      {
        row: 2,
        name: '',
        email: 'ada@example.test',
        team: 'Platform',
        lead: 'x',
      },
    ]);
    expect(await csv('E-mail,Team\nada@example.test,Platform')).toBeNull();
  });

  it('returns null for a file without Email and Team columns', async () => {
    expect(
      await csv('email,contractStartDate\nada@example.test,2025-09-01'),
    ).toBeNull();
    expect(await csv('')).toBeNull();
  });

  it('refuses more than 1000 rows', async () => {
    const lines = (count: number) =>
      Array.from({ length: count }, (_, i) => `u${i}@example.test,T`);

    expect(await csv(['Email,Team', ...lines(1000)].join('\n'))).toHaveLength(
      1000,
    );
    await expect(
      csv(['Email,Team', ...lines(1001)].join('\n')),
    ).rejects.toEqual(
      new BadRequestException('A team file can have up to 1000 rows.'),
    );
  });

  it("reads back the ' the template puts before text that starts like a formula", async () => {
    const written = ['=Ann', '@ann@example.test', '@Mobile', '+1'].map(csvText);

    expect(
      await parse(
        Buffer.from(toCsv([['Name', 'Email', 'Team', 'Team lead'], written])),
        'team-setup.csv',
      ),
    ).toEqual([
      {
        row: 2,
        name: '=Ann',
        email: '@ann@example.test',
        team: '@Mobile',
        lead: '+1',
      },
    ]);
    expect(await csv("Email,Team\nada@example.test,'Ops\n")).toEqual([
      { row: 2, name: '', email: 'ada@example.test', team: "'Ops", lead: '' },
    ]);
  });

  it('numbers the lines of a CRLF CSV with a quoted multi-line cell', async () => {
    const text =
      'Name,Email,Team\r\n"Ada\r\nL.",ada@example.test,Platform\r\nBob,bob@example.test,Design\r\n';

    expect(await csv(text)).toEqual([
      {
        row: 2,
        name: 'Ada\nL.',
        email: 'ada@example.test',
        team: 'Platform',
        lead: '',
      },
      {
        row: 4,
        name: 'Bob',
        email: 'bob@example.test',
        team: 'Design',
        lead: '',
      },
    ]);
  });

  it('keeps the sheet row number after a blank row and reads formula, rich text and hyperlink cells as text', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Team');
    sheet.addRow(['Name', 'Email', 'Team']);
    sheet.addRow([
      { richText: [{ text: 'Ada ' }, { text: 'L.', font: { bold: true } }] },
      { text: 'ada@example.test', hyperlink: 'mailto:ada@example.test' },
      { formula: '"Plat"&"form"', result: 'Platform' },
    ]);
    sheet.getRow(4).values = ['Bob', 'bob@example.test', 'Design'];
    const content = Buffer.from(await workbook.xlsx.writeBuffer());

    expect(await parse(content, 'team.xlsx')).toEqual([
      {
        row: 2,
        name: 'Ada L.',
        email: 'ada@example.test',
        team: 'Platform',
        lead: '',
      },
      {
        row: 4,
        name: 'Bob',
        email: 'bob@example.test',
        team: 'Design',
        lead: '',
      },
    ]);
  });
});
