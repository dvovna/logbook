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
      time_off_minutes_per_day: row.time_off_minutes_per_day,
      uninstalled_at: row.uninstalled_at,
      members_imported_at: row.members_imported_at,
      team_told_at: row.team_told_at,
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

  // A refreshed pair, saved only while the stored refresh token is still
  // `current` as it was read (encrypted with a random IV, so no two stored
  // pairs share it): a reinstall, an uninstall or another process's refresh
  // that came first is never overwritten. False when one did.
  public async replaceTokens(
    id: string,
    current: string,
    tokens: IStoredTokens,
  ): Promise<boolean> {
    const rows = await this.failingWith('Failed to save the bot token', () =>
      this.db
        .updateTable('slack_teams')
        .set(tokens)
        .where('id', '=', id)
        .where('slack_refresh_token', '=', current)
        .returning('id')
        .execute(),
    );

    return rows.length > 0;
  }

  // Marks the daily member import of the workspace as started at `now`,
  // unless one started after `since`: true for the one caller that marked
  // it, false when another process did (or the workspace is uninstalled).
  public async claimMemberSync(
    id: string,
    since: Date,
    now: Date,
  ): Promise<boolean> {
    const rows = await this.failingWith(
      'Failed to claim the member import',
      () =>
        this.db
          .updateTable('slack_teams')
          .set({ members_synced_at: now.toISOString() })
          .where('id', '=', id)
          .where('uninstalled_at', 'is', null)
          .where((eb) =>
            eb.or([
              eb('members_synced_at', 'is', null),
              eb('members_synced_at', '<=', since.toISOString()),
            ]),
          )
          .returning('id')
          .execute(),
    );

    return rows.length > 0;
  }

  // Marks the reminder of the week starting `monday` as sent, once: true for
  // the one caller that marked it, false when it was sent already (or the
  // workspace is uninstalled).
  public claimReminderWeek(id: string, monday: string): Promise<boolean> {
    return this.claimDate(id, 'time_reminder_week', monday, 'weekly reminder');
  }

  // The same for the reminder of `day`, which goes to the people reminded
  // every working day.
  public claimReminderDay(id: string, day: string): Promise<boolean> {
    return this.claimDate(id, 'time_reminder_day', day, 'daily reminder');
  }

  // The same for the approvers' reminders of what waits for them.
  public claimApproverReminderWeek(
    id: string,
    monday: string,
  ): Promise<boolean> {
    return this.claimDate(
      id,
      'approver_reminder_week',
      monday,
      'weekly approver reminder',
    );
  }

  public claimApproverReminderDay(id: string, day: string): Promise<boolean> {
    return this.claimDate(
      id,
      'approver_reminder_day',
      day,
      'daily approver reminder',
    );
  }

  private async claimDate(
    id: string,
    column:
      | 'time_reminder_week'
      | 'time_reminder_day'
      | 'approver_reminder_week'
      | 'approver_reminder_day',
    date: string,
    what: string,
  ): Promise<boolean> {
    const rows = await this.failingWith(`Failed to claim the ${what}`, () =>
      this.db
        .updateTable('slack_teams')
        .set({ [column]: date })
        .where('id', '=', id)
        .where('uninstalled_at', 'is', null)
        .where((eb) => eb.or([eb(column, 'is', null), eb(column, '<', date)]))
        .returning('id')
        .execute(),
    );

    return rows.length > 0;
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
