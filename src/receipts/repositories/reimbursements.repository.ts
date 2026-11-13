import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';

@Injectable()
export class ReimbursementsRepository extends BaseRepository<
  'reimbursements',
  IReimbursementViewModel
> {
  protected readonly tableName = 'reimbursements';

  // The archived ones that still hold a receipt Finance sees (not a draft),
  // by name.
  public async findArchivedWithReceipts(
    slackTeamId: string,
  ): Promise<IReimbursementViewModel[]> {
    const rows = await this.selectInWorkspace(slackTeamId)
      .selectAll('reimbursements')
      .where('reimbursements.archived_at', 'is not', null)
      .where(({ exists, selectFrom }) =>
        exists(
          selectFrom('receipts')
            .select('receipts.id')
            .where('receipts.slack_team_id', '=', slackTeamId)
            .whereRef('receipts.reimbursement_id', '=', 'reimbursements.id')
            .where('receipts.status', '<>', ReceiptStatus.Draft),
        ),
      )
      .orderBy('reimbursements.name')
      .execute();

    return rows.map((row) => this.toViewModel(row));
  }

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
