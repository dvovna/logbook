import { BadRequestException } from '@nestjs/common';
import { readSpreadsheet } from '@common/files/spreadsheet.reader';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { parseLeaveFile } from 'src/leave-file/parsers/leave-file.parser';

const csv = async (text: string) =>
  parseLeaveFile(await readSpreadsheet(Buffer.from(text), 'leave.csv'));

describe('parseLeaveFile', () => {
  it('recognizes a balances file', async () => {
    const file = await csv(
      'Name,Email,Contract start,Balance on,Days left,Working days left,Bonus days left\nAda,ada@example.test,2024-01-15,2026-11-01,12,8,2\n',
    );

    expect(file).toEqual({
      kind: LeaveFileKind.Balances,
      rows: [
        {
          row: 2,
          name: 'Ada',
          email: 'ada@example.test',
          contractStart: '2024-01-15',
          balanceOn: '2026-11-01',
          daysLeft: '12',
          workingDaysLeft: '8',
          bonusDaysLeft: '2',
        },
      ],
    });
  });

  it('recognizes a history file', async () => {
    const file = await csv(
      'Name,Email,Leave type,From,To,Comment\nAda,ada@example.test,Annual leave,2026-07-01,2026-07-05,Trip\n',
    );

    expect(file).toEqual({
      kind: LeaveFileKind.History,
      rows: [
        {
          row: 2,
          name: 'Ada',
          email: 'ada@example.test',
          leaveType: 'Annual leave',
          from: '2026-07-01',
          to: '2026-07-05',
          comment: 'Trip',
        },
      ],
    });
  });

  it('matches headers ignoring case and spaces', async () => {
    const file = await csv('EMAIL, days LEFT\nada@example.test,5\n');

    expect(file?.kind).toBe(LeaveFileKind.Balances);
  });

  it('reads a missing optional column as an empty cell', async () => {
    const file = await csv('Email,Days left\nada@example.test,5\n');

    expect(file).toEqual({
      kind: LeaveFileKind.Balances,
      rows: [
        {
          row: 2,
          name: '',
          email: 'ada@example.test',
          contractStart: '',
          balanceOn: '',
          daysLeft: '5',
          workingDaysLeft: '',
          bonusDaysLeft: '',
        },
      ],
    });
  });

  it('is not a leave file with Email and Team columns', async () => {
    expect(
      await csv('Email,Team,Days left\nada@example.test,Platform,5\n'),
    ).toBeNull();
  });

  it('is not a leave file with Email alone', async () => {
    expect(await csv('Email\nada@example.test\n')).toBeNull();
  });

  it('is not a balances file with Email and Balance on alone', async () => {
    expect(
      await csv('Email,Balance on\nada@example.test,2026-11-01\n'),
    ).toBeNull();
  });

  it('is not a history file without To', async () => {
    expect(
      await csv('Email,Leave type,From\nada@example.test,Annual leave,x\n'),
    ).toBeNull();
  });

  it('keeps row numbers', async () => {
    const file = await csv(
      'Email,Days left\na@example.test,1\nb@example.test,2\n',
    );

    expect(file?.rows.map((r) => r.row)).toEqual([2, 3]);
  });

  it('refuses more than 5000 rows', async () => {
    const lines = Array.from(
      { length: 5001 },
      (_, i) => `u${i}@example.test,1`,
    );
    const text = `Email,Days left\n${lines.join('\n')}\n`;

    await expect(csv(text)).rejects.toThrow(
      new BadRequestException('A leave file can have up to 5000 rows.'),
    );
  });
});
