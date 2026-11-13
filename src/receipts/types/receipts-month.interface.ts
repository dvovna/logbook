import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';

export interface IReceiptsMonthReceipt extends IReceiptViewModel {
  late: boolean;
  // Other people who sent the same file, by name.
  alsoSentBy: string[];
}

export interface IReceiptsMonthPerson {
  userId: string;
  name: string;
  email: string;
  teamName: string | null;
  receipts: IReceiptsMonthReceipt[];
  acceptedCents: number;
  submittedCents: number;
  toReimburseCents: number;
  overLimit: boolean;
}

export interface IReceiptsMonth {
  reimbursement: IReimbursementViewModel;
  month: string;
  dueDate: string;
  people: IReceiptsMonthPerson[];
  sentNothing: { userId: string; name: string }[];
  waiting: number;
}
