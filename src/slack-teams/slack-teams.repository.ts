import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import UserRole from '@common/enums/user-role.enum';
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
  'slack_teams',
  ISlackTeamViewModel
> {
  protected readonly tableName = 'slack_teams';

  // The workspaces themselves: their queries name no workspace column.
  protected readonly workspaceColumn = null;

  // The bot token stays out of the view model, so it doesn't travel with every
  // workspace object (logs, errors, views). findStoredTokens reads it.
  protected mapToViewModel = (row: SqlRow<'slack_teams'>) => {
    return {
      id: row.id,
      name: row.name,
      slack_id: row.slack_id,
      created_at: row.created_at,
      currency: row.currency,
      uninstalled_at: row.uninstalled_at,
    };
  };

  public async findStoredTokens(id: string): Promise<IStoredTokens | null> {
    const row = await this.failingWith('Failed to read the bot token', () =>
      this.db
        .selectFrom('slack_teams')
        .select([
          'slack_token',
          'slack_refresh_token',
          'slack_token_expires_at',
        ])
        .where('id', '=', id)
        .executeTakeFirst(),
    );

    return row ?? null;
  }

  // The workspace and its installing admin. Two statements: the caller runs
  // them in one transaction, so a workspace is never without its admin.
  public async createWorkspace({
    slackId,
    name,
    tokens,
    admin,
  }: ICreateWorkspaceRow): Promise<ISlackTeamViewModel> {
    const workspace = await this.db
      .insertInto('slack_teams')
      .values({ slack_id: slackId, name, ...tokens })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.db
      .insertInto('users')
      .values({
        slack_team_id: workspace.id,
        slack_id: admin.slackId,
        email: admin.email,
        name: admin.name,
        role: UserRole.Admin,
      })
      .execute();

    return this.mapToViewModel(workspace);
  }

  // Workspaces whose token is still stored in plain text.
  public async findPlainTextTokens(): Promise<IStoredToken[]> {
    const rows = await this.failingWith('Failed to read the bot tokens', () =>
      this.db
        .selectFrom('slack_teams')
        .select(['id', 'slack_token'])
        .where('slack_token', 'not like', 'v1:%')
        .execute(),
    );

    // `not like` leaves out the workspaces without a token.
    return rows as IStoredToken[];
  }

  public async saveToken(id: string, storedToken: string) {
    await this.saveTokens(id, { slack_token: storedToken });
  }

  public async saveTokens(id: string, tokens: Partial<IStoredTokens>) {
    await this.failingWith('Failed to save the bot token', () =>
      this.db
        .updateTable('slack_teams')
        .set(tokens)
        .where('id', '=', id)
        .execute(),
    );
  }

  private async failingWith<T>(message: string, query: () => Promise<T>) {
    try {
      return await query();
    } catch (error) {
      throw Object.assign(
        new Error(`${message}: ${(error as Error).message}`),
        { cause: error },
      );
    }
  }
}
