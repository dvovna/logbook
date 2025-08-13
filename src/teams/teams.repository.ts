import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from 'src/common/repositories/base.repository';
import ITeamViewModel from 'src/teams/types/team.interface';

@Injectable()
export class TeamsRepository extends BaseRepository<
  Tables['teams'],
  ITeamViewModel
> {
  protected tableName: TableName = 'teams';

  protected mapToViewModel = (row: Tables['teams']['Row']) => {
    return {
      id: row.id,
      name: row.name,
      slack_team_id: row.slack_team_id,
      is_primary: row.is_primary,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
    };
  };
}
