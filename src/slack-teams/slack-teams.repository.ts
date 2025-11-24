import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import ISlackTeamViewModel from '@modules/slack-teams/types/slack-team.interface';

@Injectable()
export class SlackTeamsRepository extends BaseRepository<
  Tables['slack_teams'],
  ISlackTeamViewModel
> {
  protected tableName: TableName = 'slack_teams';

  protected mapToViewModel = (row: Tables['slack_teams']['Row']) => {
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
