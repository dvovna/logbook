import { unzipSync } from 'fflate';
import { ReceiptStatus } from '@modules/receipts/enums/receipt-status.enum';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { ReceiptsArchiveService } from '@modules/receipts/services/receipts-archive.service';
import {
  IReceiptsMonth,
  IReceiptsMonthPerson,
  IReceiptsMonthReceipt,
} from '@modules/receipts/types/receipts-month.interface';

const receipt = (
  fields: Partial<IReceiptsMonthReceipt> = {},
): IReceiptsMonthReceipt => ({
  id: 'r1',
  slackTeamId: 'team',
  userId: 'u1',
  reimbursementId: 'rb',
  month: '2026-10-01',
  amountCents: 2500,
  comment: null,
  status: ReceiptStatus.Accepted,
  rejectionReason: null,
  decidedBy: 'boss',
  decidedAt: '2026-11-02T10:00:00.000Z',
  submittedAt: '2026-11-01T09:30:00.000Z',
  fileName: 'IMG_1.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 10,
  sha256: 'x',
  slackFileId: 'F1',
  fileDeletedAt: null,
  createdAt: '2026-11-01T09:00:00.000Z',
  late: false,
  alsoSentBy: [],
  sentAgain: false,
  decidedByName: 'Bea Boss',
  ...fields,
});

const person = (
  fields: Partial<IReceiptsMonthPerson> = {},
): IReceiptsMonthPerson => ({
  userId: 'u1',
  name: 'Anna Kim',
  email: 'anna@example.com',
  active: true,
  teamName: 'Core',
  receipts: [receipt()],
  acceptedCents: 2500,
  submittedCents: 0,
  toReimburseCents: 2500,
  overLimit: false,
  ...fields,
});

const month = (people: IReceiptsMonthPerson[]): IReceiptsMonth => ({
  reimbursement: {
    id: 'rb',
    slackTeamId: 'team',
    name: 'Sport',
    dueDay: 5,
    limitCents: 5000,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  month: '2026-10-01',
  dueDate: '2026-11-05',
  people,
  sentNothing: [],
  waiting: 0,
});

describe('ReceiptsArchiveService', () => {
  const store = { get: jest.fn() };
  const service = new ReceiptsArchiveService(
    store as unknown as ReceiptFileStore,
    { partBytes: 100, partsPerSecond: 1, maxParts: 50 },
  );

  beforeEach(() => store.get.mockReset());

  describe('buildPart', () => {
    it('zips the entries as they are', () => {
      const zip = service.buildPart([
        { name: 'Anna Kim - 1.pdf', content: Buffer.from('%PDF') },
      ]);

      expect(Object.keys(unzipSync(zip))).toEqual(['Anna Kim - 1.pdf']);
      expect(Buffer.from(unzipSync(zip)['Anna Kim - 1.pdf']).toString()).toBe(
        '%PDF',
      );
    });
  });

  describe('plan', () => {
    it('writes the receipts of a month, one line each, ready for a spreadsheet', () => {
      const { receiptsCsv } = service.plan(month([person()]), 'USD');

      expect(receiptsCsv).toBe(
        '﻿Person,Email,Team,Reimbursement,Month,Amount,Currency,Status,Reason,Sent on,Decided by,File\r\n' +
          'Anna Kim,anna@example.com,Core,Sport,2026-10,25.00,USD,accepted,,2026-11-01,Bea Boss,Anna Kim - 1.pdf\r\n',
      );
    });

    it('keeps text that starts like a formula from running', () => {
      const { receiptsCsv } = service.plan(
        month([
          person({
            receipts: [
              receipt({
                status: ReceiptStatus.Rejected,
                rejectionReason: '=HYPERLINK("x")',
                decidedByName: null,
                amountCents: null,
              }),
            ],
          }),
        ]),
        'USD',
      );

      expect(receiptsCsv).toContain(`"'=HYPERLINK(""x"")"`);
    });

    it('works the totals out as the screen does: the limit caps what is reimbursed', () => {
      const { totalsCsv } = service.plan(
        month([person({ acceptedCents: 6000, toReimburseCents: 5000 })]),
        'USD',
      );

      expect(totalsCsv).toBe(
        '﻿Person,Email,Accepted,Limit,To reimburse\r\n' +
          'Anna Kim,anna@example.com,60.00,50.00,50.00\r\n',
      );
    });

    it('leaves the limit empty when there is none', () => {
      const unlimited = month([person()]);
      unlimited.reimbursement.limitCents = null;

      expect(service.plan(unlimited, 'USD').totalsCsv).toContain(
        'Anna Kim,anna@example.com,25.00,,25.00',
      );
    });

    it('names the files after the person and counts their receipts', () => {
      const { parts } = service.plan(
        month([
          person({
            receipts: [
              receipt({ id: 'a', fileName: 'one.JPG' }),
              receipt({ id: 'b', fileName: 'two.png' }),
            ],
          }),
        ]),
        'USD',
      );

      expect(
        parts.flat().map(({ receiptId, name }) => [receiptId, name]),
      ).toEqual([
        ['a', 'Anna Kim - 1.JPG'],
        ['b', 'Anna Kim - 2.png'],
      ]);
    });

    it('makes a safe entry name of whatever a person is called', () => {
      const { parts } = service.plan(
        month([person({ name: '=cmd/..\\x', email: 'x@example.com' })]),
        'USD',
      );
      const [{ name }] = parts[0];

      expect(name).toBe('_cmd_.._x - 1.pdf');
      expect(name).not.toMatch(/[/\\]/);
    });

    it('does not let two people with one name share a file name', () => {
      const { parts } = service.plan(
        month([
          person({ userId: 'u1' }),
          person({
            userId: 'u2',
            email: 'anna2@example.com',
            receipts: [receipt({ id: 'r2', userId: 'u2' })],
          }),
        ]),
        'USD',
      );
      const names = parts.flat().map(({ name }) => name);

      expect(new Set(names).size).toBe(2);
    });

    it('leaves out the file of a receipt past retention, and its File cell', () => {
      const { receiptsCsv, parts } = service.plan(
        month([
          person({
            receipts: [receipt({ fileDeletedAt: '2026-12-01T00:00:00.000Z' })],
          }),
        ]),
        'USD',
      );

      expect(parts).toEqual([[]]);
      expect(receiptsCsv).toContain('Bea Boss,\r\n');
    });

    it('splits the files into parts of at most the limit', () => {
      const { parts } = service.plan(
        month([
          person({
            receipts: [
              receipt({ id: 'a', sizeBytes: 60 }),
              receipt({ id: 'b', sizeBytes: 60 }),
              receipt({ id: 'c', sizeBytes: 30 }),
            ],
          }),
        ]),
        'USD',
      );

      expect(
        parts.map((part) => part.map(({ receiptId }) => receiptId)),
      ).toEqual([['a'], ['b', 'c']]);
    });
  });

  describe('readPart', () => {
    it('reads the files of a part from the store, in order', async () => {
      store.get.mockImplementation(async (id: string) => Buffer.from(id));

      const entries = await service.readPart(
        [
          { receiptId: 'a', name: 'A.pdf', sizeBytes: 1 },
          { receiptId: 'b', name: 'B.pdf', sizeBytes: 1 },
        ],
        'team',
      );

      expect(
        entries.map(({ name, content }) => [name, content.toString()]),
      ).toEqual([
        ['A.pdf', 'a'],
        ['B.pdf', 'b'],
      ]);
      expect(store.get).toHaveBeenCalledWith('a', 'team');
    });

    it('skips a file that is gone since', async () => {
      store.get.mockResolvedValue(null);

      expect(
        await service.readPart(
          [{ receiptId: 'a', name: 'A.pdf', sizeBytes: 1 }],
          'team',
        ),
      ).toEqual([]);
    });
  });
});
