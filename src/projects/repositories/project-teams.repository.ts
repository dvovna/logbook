import { Injectable } from '@nestjs/common';
import { SqlRepository } from '@common/repositories/sql.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { IProjectTeamViewModel } from 'src/projects/types/project-team.types';

@Injectable()
export class ProjectTeamsRepository extends SqlRepository<
  'project_teams',
  IProjectTeamViewModel
> {
  protected readonly tableName = 'project_teams';
  protected defaultOrderBy = ['project_id:asc'];

  protected readonly uniqueOrder = ['project_id:asc', 'team_id:asc'];

  protected mapToViewModel = (row: SqlRow<'project_teams'>) => {
    return {
      slack_team_id: row.slack_team_id,
      project_id: row.project_id,
      team_id: row.team_id,
    };
  };
}
