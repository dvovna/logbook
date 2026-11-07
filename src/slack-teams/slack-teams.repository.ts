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

  // The bot token stays out of the view model, so it doesn't travel with every
  // workspace object (logs, errors, views). findAccessToken reads it.
  protected mapToViewModel = (row: Tables['slack_teams']['Row']) => {
    return {
      id: row.id,
      name: row.name,
      slack_id: row.slack_id,
      created_at: row.created_at,
    };
  };

  public async findAccessToken(id: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('slack_teams')
      .select('slack_token')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read the bot token: ${error.message}`);
    }

    return data?.slack_token ?? null;
  }
}
