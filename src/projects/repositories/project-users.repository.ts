import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { IProjectUserViewModel } from 'src/projects/types/project-user.types';

@Injectable()
export class ProjectUsersRepository extends BaseRepository<
  'project_users',
  IProjectUserViewModel
> {
  protected readonly tableName = 'project_users';
  protected defaultOrderBy = ['project_id:asc'];

  protected readonly uniqueOrder = ['project_id:asc', 'user_id:asc'];

  protected mapToViewModel = (row: SqlRow<'project_users'>) => {
    return {
      slack_team_id: row.slack_team_id,
      project_id: row.project_id,
      user_id: row.user_id,
    };
  };
}
