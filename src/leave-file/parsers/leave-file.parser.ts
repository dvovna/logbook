import { BadRequestException } from '@nestjs/common';
import {
  cellAt,
  columnsOf,
  ISpreadsheetLine,
  normalizeHeader,
} from '@common/files/spreadsheet.reader';
import {
  BALANCES_HEADERS,
  HISTORY_HEADERS,
} from 'src/leave-file/constants/leave-file-headers';
import { MAX_LEAVE_FILE_ROWS } from 'src/leave-file/constants/leave-file-limits';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import {
  ILeaveBalanceRow,
  ILeaveFile,
  ILeaveHistoryRow,
} from 'src/leave-file/types/leave-file-row.interface';

type Column =
  | 'name'
  | 'email'
  | 'contractStart'
  | 'balanceOn'
  | 'daysLeft'
  | 'workingDaysLeft'
  | 'bonusDaysLeft'
  | 'leaveType'
  | 'from'
  | 'to'
  | 'comment'
  | 'team';

const FIELD_OF_HEADER: Record<
  (typeof BALANCES_HEADERS | typeof HISTORY_HEADERS)[number] | 'Team',
  Column
> = {
  Name: 'name',
  Email: 'email',
  'Contract start': 'contractStart',
  'Balance on': 'balanceOn',
  'Days left': 'daysLeft',
  'Working days left': 'workingDaysLeft',
  'Bonus days left': 'bonusDaysLeft',
  'Leave type': 'leaveType',
  From: 'from',
  To: 'to',
  Comment: 'comment',
  Team: 'team',
};

const COLUMN_OF_HEADER = new Map<string, Column>(
  Object.entries(FIELD_OF_HEADER).map(([header, column]) => [
    normalizeHeader(header),
    column,
  ]),
);

// "Balance on" alone doesn't make a balances file: it only dates the numbers.
const BALANCE_VALUE_COLUMNS: Column[] = [
  'contractStart',
  'daysLeft',
  'workingDaysLeft',
  'bonusDaysLeft',
];

// Reads the lines of a leave file into raw rows, by what its header holds.
// Null when it is neither a balances nor a history file. A history may have a
// Team column beside its Leave type, From and To; any other file with Email
// and Team columns is the team file's.
export const parseLeaveFile = (
  lines: ISpreadsheetLine[],
): ILeaveFile | null => {
  const [header, ...data] = lines;
  const columns = columnsOf(header, COLUMN_OF_HEADER);

  if (!columns.has('email')) {
    return null;
  }

  const isHistory =
    columns.has('leaveType') && columns.has('from') && columns.has('to');
  const isBalances =
    !columns.has('team') && BALANCE_VALUE_COLUMNS.some((c) => columns.has(c));

  if (!isHistory && !isBalances) {
    return null;
  }

  if (data.length > MAX_LEAVE_FILE_ROWS) {
    throw new BadRequestException(
      `A leave file can have up to ${MAX_LEAVE_FILE_ROWS} rows.`,
    );
  }

  const cell = (line: ISpreadsheetLine, column: Column) =>
    cellAt(line, columns.get(column));

  if (isHistory) {
    const rows: ILeaveHistoryRow[] = data.map((line) => ({
      row: line.row,
      name: cell(line, 'name'),
      email: cell(line, 'email'),
      leaveType: cell(line, 'leaveType'),
      from: cell(line, 'from'),
      to: cell(line, 'to'),
      comment: cell(line, 'comment'),
    }));

    return { kind: LeaveFileKind.History, rows };
  }

  const rows: ILeaveBalanceRow[] = data.map((line) => ({
    row: line.row,
    name: cell(line, 'name'),
    email: cell(line, 'email'),
    contractStart: cell(line, 'contractStart'),
    balanceOn: cell(line, 'balanceOn'),
    daysLeft: cell(line, 'daysLeft'),
    workingDaysLeft: cell(line, 'workingDaysLeft'),
    bonusDaysLeft: cell(line, 'bonusDaysLeft'),
  }));

  return { kind: LeaveFileKind.Balances, rows };
};
