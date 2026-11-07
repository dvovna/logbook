import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';

@Injectable()
export class TimeEntriesRepository extends BaseRepository<
  Tables['time_entries'],
  ITimeEntryViewModel
> {
  protected tableName: TableName = 'time_entries';

  protected relations = {
    user: 'user_id ( id, name, email, slack_id )',
    team: 'team_id ( id, name )',
    client: 'client_id ( id, name )',
    project: 'project_id ( id, name )',
  };

  protected mapToViewModel = (row: Tables['time_entries']['Row']) => {
    const extendedRow = row as Tables['time_entries']['Row'] & {
      user?: { id: string; name: string; email: string; slack_id: string };
      team?: { id: string; name: string };
      client?: { id: string; name: string };
      project?: { id: string; name: string };
    };

    return {
      id: row.id,
      description: row.description || '',
      rejection_reason: row.rejection_reason ?? null,
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      user_id: row.user_id,
      user: extendedRow.user
        ? {
            id: extendedRow.user.id,
            name: extendedRow.user.name,
            email: extendedRow.user.email,
            slack_id: extendedRow.user.slack_id,
          }
        : null,
      client: extendedRow.client
        ? {
            id: extendedRow.client.id,
            name: extendedRow.client.name,
          }
        : null,
      project: extendedRow.project
        ? {
            id: extendedRow.project.id,
            name: extendedRow.project.name,
          }
        : null,
      team: extendedRow.team
        ? {
            id: extendedRow.team.id,
            name: extendedRow.team.name,
          }
        : null,
      client_id: row.client_id || null,
      work_date: row.work_date,
      minutes: row.minutes,
      billable: row.billable,
      status: row.status as TimeEntryStatus,
      project_id: row.project_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by,
    };
  };
}
