import { Injectable } from '@nestjs/common';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';

// Never reads the bytes: they are in receipt_files, which the file store owns.
@Injectable()
export class ReceiptsRepository extends BaseRepository<
  'receipts',
  IReceiptViewModel
> {
  protected readonly tableName = 'receipts';

  // Who sent each file (by its hash) that a reimbursement's month holds: the
  // owners of every sent receipt, in any month, with the same file as one of
  // those, once per receipt. The receipt's own owner is among them.
  public async findFileOwners(
    slackTeamId: string,
    reimbursementId: string,
    month: string,
  ): Promise<Map<string, string[]>> {
    const rows = await this.db
      .selectFrom('receipts as mine')
      .innerJoin('receipts as same', (join) =>
        join
          .onRef('same.slack_team_id', '=', 'mine.slack_team_id')
          .onRef('same.sha256', '=', 'mine.sha256'),
      )
      .select(['same.id', 'same.sha256', 'same.user_id'])
      .distinct()
      .where('mine.slack_team_id', '=', slackTeamId)
      .where('mine.reimbursement_id', '=', reimbursementId)
      .where('mine.month', '=', month)
      .where('mine.status', '<>', ReceiptStatus.Draft)
      .where('same.status', '<>', ReceiptStatus.Draft)
      .execute();

    const owners = new Map<string, string[]>();

    for (const { sha256, user_id } of rows) {
      owners.set(sha256, [...(owners.get(sha256) ?? []), user_id]);
    }

    return owners;
  }

  // Their files go with them (receipt_files cascades).
  public async deleteDraftsBefore(
    slackTeamId: string,
    cutoff: Date,
  ): Promise<number> {
    const result = await this.deleteInWorkspace(slackTeamId)
      .where('status', '=', ReceiptStatus.Draft)
      .where('created_at', '<', cutoff.toISOString())
      .executeTakeFirstOrThrow();

    return Number(result.numDeletedRows);
  }

  // Only decided receipts: the file of one Finance hasn't decided on is the
  // evidence it needs, however old.
  // Rows another sweep holds are skipped, so two processes never wait for or
  // repeat each other.
  public async lockIdsWithFilesBefore(
    slackTeamId: string,
    cutoff: Date,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.selectInWorkspace(slackTeamId)
      .select('id')
      .where('status', 'in', [ReceiptStatus.Accepted, ReceiptStatus.Rejected])
      .where('file_deleted_at', 'is', null)
      .where('decided_at', '<', cutoff.toISOString())
      .orderBy('decided_at')
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();

    return rows.map(({ id }) => id as string);
  }

  public async markFilesDeleted(
    slackTeamId: string,
    ids: string[],
    at: Date,
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const result = await this.updateInWorkspace(slackTeamId)
      .set({ file_deleted_at: at.toISOString() })
      .where('id', '=', (eb) => eb.fn.any(eb.val(ids)))
      .where('file_deleted_at', 'is', null)
      .executeTakeFirstOrThrow();

    return Number(result.numUpdatedRows);
  }

  protected mapToViewModel = (row: SqlRow<'receipts'>): IReceiptViewModel => ({
    id: row.id,
    slackTeamId: row.slack_team_id,
    userId: row.user_id,
    reimbursementId: row.reimbursement_id,
    month: row.month,
    amountCents: row.amount_cents,
    comment: row.comment,
    status: row.status as ReceiptStatus,
    rejectionReason: row.rejection_reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    submittedAt: row.submitted_at,
    fileName: row.file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    slackFileId: row.slack_file_id,
    fileDeletedAt: row.file_deleted_at,
    createdAt: row.created_at,
  });
}
