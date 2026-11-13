import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';

export interface IReimbursementReminder {
  reimbursementId: string;
  month: string;
  kind: string;
}

// Which reminder of which month went out, so that it goes out once.
@Injectable()
export class ReimbursementRemindersRepository extends BaseRepository<
  'reimbursement_reminders',
  IReimbursementReminder
> {
  protected readonly tableName = 'reimbursement_reminders';

  protected readonly uniqueOrder = ['reimbursement_id:asc', 'kind:asc'];

  protected mapToViewModel = (
    row: SqlRow<'reimbursement_reminders'>,
  ): IReimbursementReminder => ({
    reimbursementId: row.reimbursement_id,
    month: row.month,
    kind: row.kind,
  });

  // True for the one caller that inserted the row, false when the reminder
  // was claimed already.
  public async claim(
    slackTeamId: string,
    reimbursementId: string,
    month: string,
    kind: string,
  ): Promise<boolean> {
    const rows = await this.db
      .insertInto('reimbursement_reminders')
      .values({
        slack_team_id: slackTeamId,
        reimbursement_id: reimbursementId,
        month,
        kind,
      })
      .onConflict((conflict) => conflict.doNothing())
      .returning('reimbursement_id')
      .execute();

    return rows.length > 0;
  }
}
