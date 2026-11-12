import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';

// Every field but `row` is the cell's text; the planners read the values.
export interface ILeaveBalanceRow {
  // The line (a CSV) or row (a sheet) number as the person sees it in the file.
  row: number;
  name: string;
  email: string;
  contractStart: string;
  balanceOn: string;
  daysLeft: string;
  workingDaysLeft: string;
  bonusDaysLeft: string;
}

export interface ILeaveHistoryRow {
  row: number;
  name: string;
  email: string;
  leaveType: string;
  from: string;
  to: string;
  comment: string;
}

export type ILeaveFile =
  | { kind: LeaveFileKind.Balances; rows: ILeaveBalanceRow[] }
  | { kind: LeaveFileKind.History; rows: ILeaveHistoryRow[] };
