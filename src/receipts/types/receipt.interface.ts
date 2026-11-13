import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';

export interface IReceiptViewModel {
  id: string;
  slackTeamId: string;
  userId: string;
  reimbursementId: string | null;
  month: string | null;
  amountCents: number | null;
  comment: string | null;
  status: ReceiptStatus;
  rejectionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  submittedAt: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  slackFileId: string;
  fileDeletedAt: string | null;
  createdAt: string;
}
