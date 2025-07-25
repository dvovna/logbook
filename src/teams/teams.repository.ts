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
      slack_id: row.slack_id,
      slack_token: row.slack_token,
      access_token: row.slack_token,
      created_at: row.created_at,
    };
  };
}
