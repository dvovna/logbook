import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import { IProjectTeamViewModel } from 'src/projects/types/project-team.types';

@Injectable()
export class ProjectTeamsRepository extends BaseRepository<
  Tables['project_teams'],
  IProjectTeamViewModel
> {
  protected tableName: TableName = 'project_teams';
  protected defaultOrderBy = ['project_id:asc'];

  protected readonly uniqueOrder = ['project_id:asc', 'team_id:asc'];

  protected mapToViewModel = (row: Tables['project_teams']['Row']) => {
    return {
      slack_team_id: row.slack_team_id,
      project_id: row.project_id,
      team_id: row.team_id,
    };
  };
}
