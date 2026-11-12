import { BadRequestException } from '@nestjs/common';
import {
  cellAt,
  columnsOf,
  ISpreadsheetLine,
  normalizeHeader,
} from '@common/files/spreadsheet.reader';
import { TEAM_FILE_HEADERS } from 'src/team-file/constants/team-file-headers';
import { MAX_TEAM_FILE_ROWS } from 'src/team-file/constants/team-file-limits';
import { ITeamFileRow } from 'src/team-file/types/team-file-row.interface';

type Column = 'name' | 'email' | 'team' | 'lead';

const FIELD_OF_HEADER: Record<(typeof TEAM_FILE_HEADERS)[number], Column> = {
  Name: 'name',
  Email: 'email',
  Team: 'team',
  'Team lead': 'lead',
};

const COLUMN_OF_HEADER = new Map<string, Column>(
  Object.entries(FIELD_OF_HEADER).map(([header, column]) => [
    normalizeHeader(header),
    column,
  ]),
);

// Reads the lines of a team file into rows. Null when its header has no Email
// and Team columns, i.e. it is not a team file.
export const parseTeamFile = (
  lines: ISpreadsheetLine[],
): ITeamFileRow[] | null => {
  const [header, ...data] = lines;
  const columns = columnsOf(header, COLUMN_OF_HEADER);

  if (!columns.has('email') || !columns.has('team')) {
    return null;
  }

  const rows = data.map((line) => ({
    row: line.row,
    name: cellAt(line, columns.get('name')),
    email: cellAt(line, columns.get('email')),
    team: cellAt(line, columns.get('team')),
    lead: cellAt(line, columns.get('lead')),
  }));

  if (rows.length > MAX_TEAM_FILE_ROWS) {
    throw new BadRequestException(
      `A team file can have up to ${MAX_TEAM_FILE_ROWS} rows.`,
    );
  }

  return rows;
};
