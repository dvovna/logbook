import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';

export interface IReceiptsMonthReceipt extends IReceiptViewModel {
  late: boolean;
  // Other people who sent the same file, by name.
  alsoSentBy: string[];
  // Who accepted or rejected it, by name (or email); null while it waits.
  decidedByName: string | null;
}

export interface IReceiptsMonthPerson {
  userId: string;
  name: string;
  email: string;
  // false for someone deactivated since, still owed their receipts.
  active: boolean;
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
