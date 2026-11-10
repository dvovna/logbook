import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import IProjectViewModel from 'src/projects/types/project.types';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';

@Injectable()
export class ProjectsRepository extends BaseRepository<
  'projects',
  IProjectViewModel
> {
  protected readonly tableName = 'projects';

  protected searchableColumns = ['name'];

  protected mapToViewModel = (row: SqlRow<'projects'>) => {
    return {
      id: row.id,
      name: row.name,
      status: row.status as ProjectStatus,
      billable: row.billable,
      hourly_rate: row.hourly_rate ?? null,
      description: row.description || '',
      slack_team_id: row.slack_team_id,
      client_id: row.client_id || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      archived_at: row.archived_at,
      archived_by: row.archived_by,
    };
  };
}
