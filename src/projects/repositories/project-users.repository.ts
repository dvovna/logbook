import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import { IProjectUserViewModel } from 'src/projects/types/project-user.types';

@Injectable()
export class ProjectUsersRepository extends BaseRepository<
  Tables['project_users'],
  IProjectUserViewModel
> {
  protected tableName: TableName = 'project_users';
  protected defaultOrderBy = ['project_id:asc'];

  protected mapToViewModel = (
    row: Tables['project_users']['Row'],
  ) => {
    return {
      slack_team_id: row.slack_team_id,
      project_id: row.project_id,
      user_id: row.user_id,
    };
  };
}
