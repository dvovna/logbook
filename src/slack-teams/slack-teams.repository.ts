import { RpcFunctionName } from '@common/enums/rpc-function-name';
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

// The bot token as stored: encrypted (or plain text from before encryption),
// with the refresh token and expiry of a rotating one.
export interface IStoredTokens {
  slack_token: string | null;
  slack_refresh_token: string | null;
  slack_token_expires_at: string | null;
}

export interface ICreateWorkspaceRow {
  slackId: string;
  name: string;
  tokens: IStoredTokens;
  admin: { slackId: string; email: string; name: string };
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
      uninstalled_at: row.uninstalled_at,
    };
  };

  public async findStoredTokens(id: string): Promise<IStoredTokens | null> {
    const { data, error } = await this.client
      .from('slack_teams')
      .select('slack_token, slack_refresh_token, slack_token_expires_at')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to read the bot token: ${error.message}`);
    }

    return data;
  }

  // The workspace and its installing admin, in one transaction.
  public async createWorkspace({
    slackId,
    name,
    tokens,
    admin,
  }: ICreateWorkspaceRow): Promise<ISlackTeamViewModel> {
    const { data, error } = await this.client.rpc(
      RpcFunctionName.CreateWorkspace,
      {
        p_slack_id: slackId,
        p_name: name,
        p_slack_token: tokens.slack_token!,
        p_slack_refresh_token: tokens.slack_refresh_token!,
        p_slack_token_expires_at: tokens.slack_token_expires_at!,
        p_admin_slack_id: admin.slackId,
        p_admin_email: admin.email,
        p_admin_name: admin.name,
      },
    );

    if (error || !data?.[0]) {
      throw new Error(
        `${RpcFunctionName.CreateWorkspace} failed: ${error?.message ?? 'no row'}`,
      );
    }

    return this.mapToViewModel(data[0]);
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
    await this.saveTokens(id, { slack_token: storedToken });
  }

  public async saveTokens(id: string, tokens: Partial<IStoredTokens>) {
    const { error } = await this.client
      .from('slack_teams')
      .update(tokens)
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to save the bot token: ${error.message}`);
    }
  }
}
