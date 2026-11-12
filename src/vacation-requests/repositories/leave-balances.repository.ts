import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ILeaveBalance } from 'src/vacation-requests/types/leave-balance.interface';

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
}
