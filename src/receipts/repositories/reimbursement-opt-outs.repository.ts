import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';

export interface IReimbursementOptOut {
  userId: string;
  reimbursementId: string;
}

// People who need no receipts for a reimbursement (no gym membership).
@Injectable()
export class ReimbursementOptOutsRepository extends BaseRepository<
  'reimbursement_opt_outs',
  IReimbursementOptOut
> {
  protected readonly tableName = 'reimbursement_opt_outs';

  // The table has no id and no created_at.
  protected defaultOrderBy = ['user_id:asc'];

  protected readonly uniqueOrder = ['user_id:asc', 'reimbursement_id:asc'];

  protected mapToViewModel = (
    row: SqlRow<'reimbursement_opt_outs'>,
  ): IReimbursementOptOut => ({
    userId: row.user_id,
    reimbursementId: row.reimbursement_id,
  });

  public async findOptedOutIds(
    slackTeamId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await this.findMany({
      slack_team_id: slackTeamId,
      user_id: userId,
    });

    return rows.map(({ reimbursementId }) => reimbursementId);
  }

  public async findOptedOutUserIds(
    slackTeamId: string,
    reimbursementId: string,
  ): Promise<string[]> {
    const rows = await this.findMany({
      slack_team_id: slackTeamId,
      reimbursement_id: reimbursementId,
    });

    return rows.map(({ userId }) => userId);
  }

  public async add(
    slackTeamId: string,
    userId: string,
    reimbursementIds: string[],
  ): Promise<void> {
    await this.upsert(
      reimbursementIds.map((reimbursementId) => ({
        slack_team_id: slackTeamId,
        user_id: userId,
        reimbursement_id: reimbursementId,
      })),
      ['user_id', 'reimbursement_id'],
    );
  }

  public async remove(
    slackTeamId: string,
    userId: string,
    reimbursementIds: string[],
  ): Promise<void> {
    await this.deleteMany({
      slack_team_id: slackTeamId,
      user_id: userId,
      reimbursement_id: reimbursementIds,
    });
  }
}
