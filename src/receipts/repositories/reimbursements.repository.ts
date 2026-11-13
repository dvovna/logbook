import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';

@Injectable()
export class ReimbursementsRepository extends BaseRepository<
  'reimbursements',
  IReimbursementViewModel
> {
  protected readonly tableName = 'reimbursements';

  protected mapToViewModel = (
    row: SqlRow<'reimbursements'>,
  ): IReimbursementViewModel => ({
    id: row.id,
    slackTeamId: row.slack_team_id,
    name: row.name,
    dueDay: row.due_day,
    limitCents: row.limit_cents,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
  });
}
