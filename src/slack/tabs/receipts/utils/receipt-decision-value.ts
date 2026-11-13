import { IReceiptViewModel } from 'src/receipts/types/receipt.interface';

export interface IDecisionValue {
  receiptId: string;
  // The receipt as the screen showed it: a decision on one sent again since
  // is refused. Missing in a value of a view published before it was added.
  expected?: { submittedAt: string };
}

// An Accept or Reject button's value (and a ⋯ option's after `<action>:`):
// the receipt's ID and when it was sent, in epoch milliseconds, so that it
// fits Slack's 75 characters of an option value.
export const toDecisionValue = ({
  id,
  submittedAt,
}: Pick<IReceiptViewModel, 'id' | 'submittedAt'>): string =>
  submittedAt ? `${id}.${Date.parse(submittedAt)}` : id;

export const parseDecisionValue = (value: string): IDecisionValue => {
  const [receiptId, sentAt] = value.split('.');

  return /^\d+$/.test(sentAt ?? '')
    ? {
        receiptId,
        expected: { submittedAt: new Date(Number(sentAt)).toISOString() },
      }
    : { receiptId };
};
