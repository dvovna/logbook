import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { IReceiptViewModel } from '@modules/receipts/types/receipt.interface';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';
import {
  buildMonthOverview,
  IMonthOverviewInput,
} from '@modules/receipts/utils/month-overview';

const reimbursement = (
  limitCents: number | null = 5000,
): IReimbursementViewModel => ({
  id: 'r1',
  slackTeamId: 'w1',
  name: 'Gym',
  dueDay: 5,
  limitCents,
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000000+00:00',
});

let counter = 0;

const receipt = (
  userId: string,
  status: ReceiptStatus,
  amountCents: number,
  fields: Partial<IReceiptViewModel> = {},
): IReceiptViewModel => ({
  id: `rc${++counter}`,
  slackTeamId: 'w1',
  userId,
  reimbursementId: 'r1',
  month: '2026-05-01',
  amountCents,
  comment: null,
  status,
  rejectionReason: null,
  decidedBy: null,
  decidedAt: null,
  submittedAt: '2026-06-02T10:00:00.000000+00:00',
  fileName: 'a.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 1,
  sha256: `sha${counter}`,
  slackFileId: `F${counter}`,
  fileDeletedAt: null,
  createdAt: '2026-06-02T10:00:00.000000+00:00',
  ...fields,
});

const person = (id: string, name: string, active = true) => ({
  id,
  name,
  active,
  email: `${id}@example.test`,
  teamName: null,
});

const overview = (input: Partial<IMonthOverviewInput>) =>
  buildMonthOverview({
    reimbursement: reimbursement(),
    month: '2026-05-01',
    receipts: [],
    people: [],
    optedOutUserIds: new Set(),
    sameFileOwners: new Map(),
    ...input,
  });

describe('buildMonthOverview', () => {
  it('counts accepted and submitted apart and lets a rejected one count nowhere', () => {
    const result = overview({
      people: [person('a', 'Ann')],
      receipts: [
        receipt('a', ReceiptStatus.Accepted, 3000),
        receipt('a', ReceiptStatus.Submitted, 3000),
        receipt('a', ReceiptStatus.Rejected, 9900),
      ],
    });

    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({
      acceptedCents: 3000,
      submittedCents: 3000,
      toReimburseCents: 3000,
      overLimit: true,
    });
    expect(result.people[0].receipts).toHaveLength(3);
    expect(result.waiting).toBe(1);
  });

  it('keeps a person with only a rejected receipt, as one who sent nothing', () => {
    const result = overview({
      people: [person('a', 'Ann')],
      receipts: [receipt('a', ReceiptStatus.Rejected, 1000)],
    });

    expect(result.people.map(({ userId }) => userId)).toEqual(['a']);
    expect(result.sentNothing).toEqual([{ userId: 'a', name: 'Ann' }]);
  });

  it('leaves drafts out everywhere', () => {
    const result = overview({
      people: [person('a', 'Ann')],
      receipts: [receipt('a', ReceiptStatus.Draft, 1000)],
    });

    expect(result.people).toEqual([]);
    expect(result.sentNothing).toHaveLength(1);
  });

  it('leaves out an opted-out person with no receipt', () => {
    const result = overview({
      people: [person('a', 'Ann')],
      optedOutUserIds: new Set(['a']),
    });

    expect(result.people).toEqual([]);
    expect(result.sentNothing).toEqual([]);
  });

  it('names the other people who sent the same file', () => {
    const own = receipt('a', ReceiptStatus.Submitted, 1000, { sha256: 'same' });
    const result = overview({
      people: [person('a', 'Ann'), person('b', 'Bob')],
      receipts: [own],
      sameFileOwners: new Map([['same', ['a', 'b']]]),
    });

    expect(result.people[0].receipts[0].alsoSentBy).toEqual(['Bob']);
  });

  it('marks a receipt sent after the due day as late and sorts by name', () => {
    const result = overview({
      people: [person('b', 'Bob'), person('a', 'Ann')],
      receipts: [
        receipt('b', ReceiptStatus.Submitted, 100, {
          submittedAt: '2026-06-06T00:00:00.000000+00:00',
        }),
        receipt('a', ReceiptStatus.Submitted, 100),
      ],
    });

    expect(result.dueDate).toBe('2026-06-05');
    expect(result.people.map(({ name }) => name)).toEqual(['Ann', 'Bob']);
    expect(result.people[0].receipts[0].late).toBe(false);
    expect(result.people[1].receipts[0].late).toBe(true);
  });

  it('keeps a deactivated owner with a submitted receipt', () => {
    const result = overview({
      people: [person('a', 'Ann', false)],
      receipts: [receipt('a', ReceiptStatus.Submitted, 1000)],
    });

    expect(result.people).toHaveLength(1);
    expect(result.people[0]).toMatchObject({ active: false });
    expect(result.waiting).toBe(1);
    expect(result.sentNothing).toEqual([]);
  });

  it('has no limit to go over without one', () => {
    const result = overview({
      reimbursement: reimbursement(null),
      people: [person('a', 'Ann')],
      receipts: [receipt('a', ReceiptStatus.Accepted, 99999)],
    });

    expect(result.people[0]).toMatchObject({
      toReimburseCents: 99999,
      overLimit: false,
    });
  });
});
