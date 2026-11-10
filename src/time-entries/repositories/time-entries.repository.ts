import { Injectable } from '@nestjs/common';
import {
  IRelation,
  BaseRepository,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';

@Injectable()
export class TimeEntriesRepository extends BaseRepository<
  'time_entries',
  ITimeEntryViewModel
> {
  protected readonly tableName = 'time_entries';

  protected relations: Record<string, IRelation> = {
    user: {
      table: 'users',
      foreignKey: 'user_id',
      columns: ['id', 'name', 'email', 'slack_id'],
    },
    team: { table: 'teams', foreignKey: 'team_id', columns: ['id', 'name'] },
    client: {
      table: 'clients',
      foreignKey: 'client_id',
      columns: ['id', 'name'],
    },
    project: {
      table: 'projects',
      foreignKey: 'project_id',
      columns: ['id', 'name'],
    },
  };

  protected mapToViewModel = (row: SqlRow<'time_entries'>) => {
    const extendedRow = row as SqlRow<'time_entries'> & {
      user?: { id: string; name: string; email: string; slack_id: string };
      team?: { id: string; name: string };
      client?: { id: string; name: string };
      project?: { id: string; name: string };
    };

    return {
      id: row.id,
      description: row.description || '',
      rejection_reason: row.rejection_reason ?? null,
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      user_id: row.user_id,
      user: extendedRow.user
        ? {
            id: extendedRow.user.id,
            name: extendedRow.user.name,
            email: extendedRow.user.email,
            slack_id: extendedRow.user.slack_id,
          }
        : null,
      client: extendedRow.client
        ? {
            id: extendedRow.client.id,
            name: extendedRow.client.name,
          }
        : null,
      project: extendedRow.project
        ? {
            id: extendedRow.project.id,
            name: extendedRow.project.name,
          }
        : null,
      team: extendedRow.team
        ? {
            id: extendedRow.team.id,
            name: extendedRow.team.name,
          }
        : null,
      client_id: row.client_id || null,
      work_date: row.work_date,
      minutes: row.minutes,
      billable: row.billable,
      status: row.status as TimeEntryStatus,
      project_id: row.project_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by,
    };
  };

  // The submitted entries of the workspace but `excludeUserId`'s, newest
  // work first: only what deciding who approves them needs, no joins.
  public async findSubmittedKeys(
    slackTeamId: string,
    excludeUserId: string,
  ): Promise<{ id: string; team_id: string | null; user_id: string }[]> {
    return this.selectInWorkspace(slackTeamId)
      .select(['id', 'team_id', 'user_id'])
      .where('status', '=', TimeEntryStatus.Submitted)
      .where('deleted_at', 'is', null)
      .where('user_id', '!=', excludeUserId)
      .orderBy('work_date', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
  }

  // Which of the entries are in a billing snapshot, and so can't change
  // until an admin unlocks it.
  public async findBilledIds(
    slackTeamId: string,
    ids: string[],
  ): Promise<Set<string>> {
    if (!slackTeamId) {
      throw new Error('[time_entries] findBilledIds without a workspace ID');
    }

    if (!ids.length) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('billing_snapshot_entries')
      .select('time_entry_id')
      .where('slack_team_id', '=', slackTeamId)
      .where('time_entry_id', 'in', ids)
      .execute();

    return new Set(rows.map(({ time_entry_id }) => time_entry_id));
  }
}
