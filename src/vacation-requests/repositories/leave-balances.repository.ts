import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ILeaveBalance } from 'src/vacation-requests/types/leave-balance.interface';
import {
  IFileBalance,
  IStoredBalance,
} from 'src/vacation-requests/utils/leave-balance.utils';

// A row as an upload left it: its upload's ID and its updated_at.
export interface ILeaveBalanceKey {
  userId: string;
  uploadId: string;
  updatedAt: string;
}

export interface ILeaveBalanceRestore extends ILeaveBalanceKey {
  before: IStoredBalance;
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

  // Sets the balances of the workspace's people, replacing a row whole, in
  // one statement. The foreign key lets a row name another workspace's
  // person, so a person who isn't the workspace's gets none, and the row of
  // another workspace is left alone. Returns the rows it set.
  public async setMany(
    slackTeamId: string,
    balances: (IFileBalance & { userId: string })[],
    uploadId: string,
    setBy: string,
  ): Promise<ILeaveBalance[]> {
    if (!balances.length) {
      return [];
    }

    const rows = await this.db
      .insertInto('leave_balances')
      .columns([
        'slack_team_id',
        'user_id',
        'balance_on',
        'days_left',
        'working_days_left',
        'bonus_days_left',
        'upload_id',
        'set_by',
        'updated_at',
      ])
      .expression(
        this.db
          .selectFrom(
            sql<{
              user_id: string;
              balance_on: string;
              days_left: number | null;
              working_days_left: number | null;
              bonus_days_left: number | null;
            }>`(
              select * from jsonb_to_recordset(${JSON.stringify(
                balances.map((balance) => ({
                  user_id: balance.userId,
                  balance_on: balance.balanceOn,
                  days_left: balance.daysLeft,
                  working_days_left: balance.workingDaysLeft,
                  bonus_days_left: balance.bonusDaysLeft,
                })),
              )}::jsonb) as balance (
                user_id uuid,
                balance_on date,
                days_left numeric,
                working_days_left numeric,
                bonus_days_left numeric
              )
            )`.as('balance'),
          )
          .innerJoin('users', 'users.id', 'balance.user_id')
          .where('users.slack_team_id', '=', slackTeamId)
          .select([
            'users.slack_team_id',
            'balance.user_id',
            'balance.balance_on',
            'balance.days_left',
            'balance.working_days_left',
            'balance.bonus_days_left',
            sql<string>`${uploadId}::uuid`.as('upload_id'),
            sql<string>`${setBy}::uuid`.as('set_by'),
            sql<string>`now()`.as('updated_at'),
          ]),
      )
      .onConflict((conflict) =>
        conflict
          .column('user_id')
          .doUpdateSet((eb) => ({
            balance_on: eb.ref('excluded.balance_on'),
            days_left: eb.ref('excluded.days_left'),
            working_days_left: eb.ref('excluded.working_days_left'),
            bonus_days_left: eb.ref('excluded.bonus_days_left'),
            upload_id: eb.ref('excluded.upload_id'),
            set_by: eb.ref('excluded.set_by'),
            updated_at: eb.ref('excluded.updated_at'),
          }))
          .whereRef(
            'leave_balances.slack_team_id',
            '=',
            'excluded.slack_team_id',
          ),
      )
      .returningAll()
      .execute();

    return rows.map((row) => this.toViewModel(row));
  }

  // Puts each row back whole as it was before (its upload, who set it and
  // when included), in one statement, only while it is as its upload left
  // it: so the Undo of the upload before still finds it as that one left
  // it. Returns the user IDs of the rows it put back.
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
          before_upload_id: string | null;
          before_set_by: string | null;
          before_updated_at: string;
        }>`(
          select * from jsonb_to_recordset(${JSON.stringify(
            restores.map(({ userId, uploadId, updatedAt, before }) => ({
              user_id: userId,
              upload_id: uploadId,
              updated_at: updatedAt,
              balance_on: before.balanceOn,
              days_left: before.daysLeft,
              working_days_left: before.workingDaysLeft,
              bonus_days_left: before.bonusDaysLeft,
              before_upload_id: before.uploadId,
              before_set_by: before.setBy,
              before_updated_at: before.updatedAt,
            })),
          )}::jsonb) as restore (
            user_id uuid,
            upload_id uuid,
            updated_at timestamptz,
            balance_on date,
            days_left numeric,
            working_days_left numeric,
            bonus_days_left numeric,
            before_upload_id uuid,
            before_set_by uuid,
            before_updated_at timestamptz
          )
        )`.as('restore'),
      )
      .set((eb) => ({
        balance_on: eb.ref('restore.balance_on'),
        days_left: eb.ref('restore.days_left'),
        working_days_left: eb.ref('restore.working_days_left'),
        bonus_days_left: eb.ref('restore.bonus_days_left'),
        upload_id: eb.ref('restore.before_upload_id'),
        set_by: eb.ref('restore.before_set_by'),
        updated_at: eb.ref('restore.before_updated_at'),
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
