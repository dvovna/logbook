import { ValidationError } from '@common/errors/validation.error';
import {
  ITimesheetCellRef,
  TimesheetCellLock,
} from 'src/time-entries/types/timesheet.types';

// A timesheet save refused `cell`. `lock`: the cell can't be changed at all,
// and why.
export class TimesheetCellError extends ValidationError {
  public readonly cell: ITimesheetCellRef;

  public constructor(
    message: string,
    { projectId, date }: ITimesheetCellRef,
    public readonly lock?: TimesheetCellLock,
  ) {
    super(message);
    this.cell = { projectId, date };
  }
}
