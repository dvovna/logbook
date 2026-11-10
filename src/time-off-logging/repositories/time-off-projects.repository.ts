import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ITimeOffProjectViewModel } from 'src/time-off-logging/types/time-off-settings.types';

@Injectable()
export class TimeOffProjectsRepository extends BaseRepository<
  'time_off_projects',
  ITimeOffProjectViewModel
> {
  protected readonly tableName = 'time_off_projects';
  protected defaultOrderBy = ['vacation_type:asc'];

  protected readonly uniqueOrder = ['vacation_type:asc'];

  protected mapToViewModel = (row: SqlRow<'time_off_projects'>) => ({
    slack_team_id: row.slack_team_id,
    vacation_type: row.vacation_type,
    project_id: row.project_id,
  });
}
