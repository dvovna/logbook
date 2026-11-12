import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ILeaveBalance } from 'src/vacation-requests/types/leave-balance.interface';

// A row as an upload left it: its upload's ID and its updated_at.
export interface ILeaveBalanceKey {
  userId: string;
  uploadId: string;
  updatedAt: string;
}

export interface ILeaveBalanceRestore extends ILeaveBalanceKey {
  balanceOn: string;
  daysLeft: number | null;
  workingDaysLeft: number | null;
  bonusDaysLeft: number | null;
}

@Injectable()
export class LeaveBalancesRepository extends BaseRepository<
  'leave_balances',
  ILeaveBalance
> {
  protected readonly tableName = 'leave_balances';

  protected mapToViewModel = (row: SqlRow<'leave_balances'>) => ({
    id: row.id,
    slack_team_id: row.slack_team_id,
    user_id: row.user_id,
    balance_on: row.balance_on,
    days_left: row.days_left,
    working_days_left: row.working_days_left,
    bonus_days_left: row.bonus_days_left,
    upload_id: row.upload_id,
    set_by: row.set_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });

  // Sets each row back to the values given, in one statement, only while it
  // is as its upload left it. The values belong to no upload any more.
  // Returns the user IDs of the rows it set.
  public async restoreUnchanged(
    slackTeamId: string,
    restores: ILeaveBalanceRestore[],
  ): Promise<string[]> {
    if (!restores.length) {
      return [];
    }

    const rows = await this.updateInWorkspace(slackTeamId)
      .from(
        sql<{
          user_id: string;
          upload_id: string;
          updated_at: string;
          balance_on: string;
          days_left: number | null;
          working_days_left: number | null;
          bonus_days_left: number | null;
        }>`(
          select * from jsonb_to_recordset(${JSON.stringify(
            restores.map((restore) => ({
              user_id: restore.userId,
              upload_id: restore.uploadId,
              updated_at: restore.updatedAt,
              balance_on: restore.balanceOn,
              days_left: restore.daysLeft,
              working_days_left: restore.workingDaysLeft,
              bonus_days_left: restore.bonusDaysLeft,
            })),
          )}::jsonb) as restore (
            user_id uuid,
            upload_id uuid,
            updated_at timestamptz,
            balance_on date,
            days_left numeric,
            working_days_left numeric,
            bonus_days_left numeric
          )
        )`.as('restore'),
      )
      .set((eb) => ({
        balance_on: eb.ref('restore.balance_on'),
        days_left: eb.ref('restore.days_left'),
        working_days_left: eb.ref('restore.working_days_left'),
        bonus_days_left: eb.ref('restore.bonus_days_left'),
        upload_id: null,
        set_by: null,
        updated_at: new Date().toISOString(),
      }))
      .whereRef('leave_balances.user_id', '=', 'restore.user_id')
      .whereRef('leave_balances.upload_id', '=', 'restore.upload_id')
      .whereRef('leave_balances.updated_at', '=', 'restore.updated_at')
      .returning('leave_balances.user_id')
      .execute();

    return rows.map(({ user_id }) => user_id);
  }

  // Deletes each row, in one statement, only while it is as its upload left
  // it. Returns the user IDs of the rows it deleted.
  public async deleteUnchanged(
    slackTeamId: string,
    keys: ILeaveBalanceKey[],
  ): Promise<string[]> {
    if (!keys.length) {
      return [];
    }

    const rows = await this.deleteInWorkspace(slackTeamId)
      .using(
        sql<{ user_id: string; upload_id: string; updated_at: string }>`(
          select * from jsonb_to_recordset(${JSON.stringify(
            keys.map((key) => ({
              user_id: key.userId,
              upload_id: key.uploadId,
              updated_at: key.updatedAt,
            })),
          )}::jsonb) as unchanged (
            user_id uuid,
            upload_id uuid,
            updated_at timestamptz
          )
        )`.as('unchanged'),
      )
      .whereRef('leave_balances.user_id', '=', 'unchanged.user_id')
      .whereRef('leave_balances.upload_id', '=', 'unchanged.upload_id')
      .whereRef('leave_balances.updated_at', '=', 'unchanged.updated_at')
      .returning('leave_balances.user_id')
      .execute();

    return rows.map(({ user_id }) => user_id);
  }
}
