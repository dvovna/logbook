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
