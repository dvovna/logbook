import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';
import {
  IReceiptsMonth,
  IReceiptsMonthPerson,
} from '@modules/receipts/types/receipts-month.interface';
import { dueDateOf, isLate } from '@modules/receipts/utils/receipt-months';
import { toReimburseCents } from '@modules/receipts/utils/reimbursed';

export interface IOverviewPerson {
  id: string;
  name: string;
  email: string;
  teamName: string | null;
  active: boolean;
}

export interface IMonthOverviewInput {
  reimbursement: IReimbursementViewModel;
  month: string;
  receipts: IReceiptViewModel[];
  // The active people of the workspace, and the owners of the receipts that
  // are not.
  people: IOverviewPerson[];
  optedOutUserIds: ReadonlySet<string>;
  // The owners' IDs of each file (by its hash), the receipt's own included.
  sameFileOwners: Map<string, string[]>;
}

const labelOf = (person: IOverviewPerson) => person.name || person.email;

const byLabel = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name);

const sumOf = (receipts: IReceiptViewModel[], status: ReceiptStatus) =>
  receipts
    .filter((receipt) => receipt.status === status)
    .reduce((sum, { amountCents }) => sum + (amountCents ?? 0), 0);

// Drafts are left out; rejected receipts are listed but count nowhere.
export const buildMonthOverview = ({
  reimbursement,
  month,
  receipts,
  people,
  optedOutUserIds,
  sameFileOwners,
}: IMonthOverviewInput): IReceiptsMonth => {
  const sent = receipts.filter(({ status }) => status !== ReceiptStatus.Draft);
  const nameOf = new Map(people.map((person) => [person.id, labelOf(person)]));

  const overview: IReceiptsMonthPerson[] = [];
  const sentNothing: IReceiptsMonth['sentNothing'] = [];

  for (const person of people) {
    const own = sent.filter(({ userId }) => userId === person.id);
    const acceptedCents = sumOf(own, ReceiptStatus.Accepted);
    const submittedCents = sumOf(own, ReceiptStatus.Submitted);
    const counted = own.some(
      ({ status }) =>
        status === ReceiptStatus.Accepted || status === ReceiptStatus.Submitted,
    );

    if (person.active && !counted && !optedOutUserIds.has(person.id)) {
      sentNothing.push({ userId: person.id, name: labelOf(person) });
    }

    if (!own.length) {
      continue;
    }

    overview.push({
      userId: person.id,
      name: labelOf(person),
      email: person.email,
      active: person.active,
      teamName: person.teamName,
      receipts: own.map((receipt) => ({
        ...receipt,
        late:
          receipt.submittedAt !== null &&
          isLate(receipt.submittedAt, month, reimbursement.dueDay),
        alsoSentBy: (sameFileOwners.get(receipt.sha256) ?? [])
          .filter((owner) => owner !== person.id)
          .map((owner) => nameOf.get(owner))
          .filter((name): name is string => name !== undefined),
        decidedByName: receipt.decidedBy
          ? (nameOf.get(receipt.decidedBy) ?? null)
          : null,
      })),
      acceptedCents,
      submittedCents,
      toReimburseCents: toReimburseCents(
        acceptedCents,
        reimbursement.limitCents,
      ),
      overLimit:
        reimbursement.limitCents !== null &&
        acceptedCents + submittedCents > reimbursement.limitCents,
    });
  }

  return {
    reimbursement,
    month,
    dueDate: dueDateOf(month, reimbursement.dueDay),
    people: overview.sort(byLabel),
    sentNothing: sentNothing.sort(byLabel),
    waiting: overview.reduce(
      (sum, { receipts: own }) =>
        sum +
        own.filter(({ status }) => status === ReceiptStatus.Submitted).length,
      0,
    ),
  };
};
