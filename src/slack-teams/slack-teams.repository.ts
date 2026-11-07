import { Injectable } from '@nestjs/common';
import {
  BaseRepository,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import ISlackTeamViewModel from '@modules/slack-teams/types/slack-team.interface';

interface IStoredToken {
  id: string;
  slack_token: string;
}

@Injectable()
export class SlackTeamsRepository extends BaseRepository<
  Tables['slack_teams'],
  ISlackTeamViewModel
> {
  protected tableName: TableName = 'slack_teams';

  // The workspaces themselves.
  protected readonly workspaceColumn = null;

  // The bot token stays out of the view model, so it doesn't travel with every
  // workspace object (logs, errors, views). findStoredToken reads it.
  protected mapToViewModel = (row: Tables['slack_teams']['Row']) => {
    return {
      id: row.id,
      name: row.name,
      slack_id: row.slack_id,
      created_at: row.created_at,
    };
  };

  // The token as stored: encrypted, or plain text from before encryption.
  public async findStoredToken(id: string): Promise<string | null> {
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

  // Workspaces whose token is still stored in plain text.
  public async findPlainTextTokens(): Promise<IStoredToken[]> {
    const { data, error } = await this.client
      .from('slack_teams')
      .select('id, slack_token')
      .not('slack_token', 'like', 'v1:%');

    if (error) {
      throw new Error(`Failed to read the bot tokens: ${error.message}`);
    }

    return (data ?? []) as unknown as IStoredToken[];
  }

  public async saveToken(id: string, storedToken: string) {
    const { error } = await this.client
      .from('slack_teams')
      .update({ slack_token: storedToken })
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to save the bot token: ${error.message}`);
    }
  }
}
