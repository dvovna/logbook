import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';

@Injectable()
export class TimeEntriesRepository extends BaseRepository<
  Tables['time_entries'],
  ITimeEntryViewModel
> {
  protected tableName: TableName = 'time_entries';

  protected mapToViewModel = (
    row: Tables['time_entries']['Row'],
  ) => {
    return {
      id: row.id,
      description: row.description || '',
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      user_id: row.user_id,
      client_id: row.client_id || null,
      work_date: row.work_date,
      minutes: row.minutes,
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
