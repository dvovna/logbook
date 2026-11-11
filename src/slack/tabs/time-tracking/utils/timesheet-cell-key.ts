import { ITimesheetCellRef } from 'src/time-entries/types/timesheet.types';

// A cell of a project and a day: the block_id and action_id of its input in
// the forms, and where an error about it shows.
export const cellKey = (projectId: string, date: string) =>
  `${projectId}_${date}`;

// A project's UUID and a day.
const CELL_KEY =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_(\d{4}-\d{2}-\d{2})$/i;

// The project and the day of a cell's key; null for the form's other fields.
export const parseCellKey = (key: string): ITimesheetCellRef | null => {
  const match = CELL_KEY.exec(key);

  return match ? { projectId: match[1], date: match[2] } : null;
};
