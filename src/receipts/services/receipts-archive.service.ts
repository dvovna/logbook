import { Inject, Injectable } from '@nestjs/common';
import { zipSync } from 'fflate';
import { csvText, toCsv } from '@common/utils/csv.utils';
import {
  IReceiptsArchiveLimits,
  RECEIPTS_ARCHIVE_LIMITS,
} from '@modules/receipts/constants/receipts-archive';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';
import { IReceiptsMonth } from '@modules/receipts/types/receipts-month.interface';
import { splitIntoParts } from '@modules/receipts/utils/archive-parts';

export interface IArchiveFile {
  receiptId: string;
  name: string;
  sizeBytes: number;
}

export interface IArchivePlan {
  receiptsCsv: string;
  totalsCsv: string;
  parts: IArchiveFile[][];
}

const money = (cents: number) => (cents / 100).toFixed(2);

// What a name may hold in a zip entry (or a file name in Slack): anything
// else, a path separator and a formula's first character included, is `_`.
export const safeFileName = (name: string) =>
  name.replace(/[^\p{L}\p{N} _.-]/gu, '_').replace(/^\./, '_');

const extensionOf = (fileName: string) =>
  /\.([A-Za-z0-9]{1,10})$/.exec(fileName)?.[1] ?? 'bin';

// A month of one reimbursement as an archive: receipts.csv and totals.csv
// in the first part, the files in as many parts as the limit asks for. The
// plan holds no file content; readPart reads a part's files when it is its
// turn, so that only one part is in memory at a time.
@Injectable()
export class ReceiptsArchiveService {
  public constructor(
    private readonly files: ReceiptFileStore,
    @Inject(RECEIPTS_ARCHIVE_LIMITS)
    private readonly limits: IReceiptsArchiveLimits,
  ) {}

  public plan(month: IReceiptsMonth, currency: string): IArchivePlan {
    const { reimbursement } = month;
    const files: IArchiveFile[] = [];
    const used = new Set<string>();
    const receiptRows: string[][] = [
      [
        'Person',
        'Email',
        'Team',
        'Reimbursement',
        'Month',
        'Amount',
        'Currency',
        'Status',
        'Reason',
        'Sent on',
        'Decided by',
        'File',
      ],
    ];
    const totalRows: string[][] = [
      ['Person', 'Email', 'Accepted', 'Limit', 'To reimburse'],
    ];

    for (const person of month.people) {
      // Two people called alike keep their own files.
      let base = safeFileName(person.name);

      for (let n = 2; used.has(base); n++) {
        base = `${safeFileName(person.name)} (${n})`;
      }

      used.add(base);

      person.receipts.forEach((receipt, i) => {
        const name = `${base} - ${i + 1}.${extensionOf(receipt.fileName)}`;
        const hasFile = receipt.fileDeletedAt === null;

        if (hasFile) {
          files.push({
            receiptId: receipt.id,
            name,
            sizeBytes: receipt.sizeBytes,
          });
        }

        receiptRows.push([
          csvText(person.name),
          csvText(person.email),
          csvText(person.teamName),
          csvText(reimbursement.name),
          month.month.slice(0, 7),
          receipt.amountCents === null ? '' : money(receipt.amountCents),
          currency,
          receipt.status,
          csvText(receipt.rejectionReason),
          receipt.submittedAt?.slice(0, 10) ?? '',
          csvText(receipt.decidedByName),
          hasFile ? name : '',
        ]);
      });

      totalRows.push([
        csvText(person.name),
        csvText(person.email),
        money(person.acceptedCents),
        reimbursement.limitCents === null
          ? ''
          : money(reimbursement.limitCents),
        money(person.toReimburseCents),
      ]);
    }

    return {
      receiptsCsv: toCsv(receiptRows),
      totalsCsv: toCsv(totalRows),
      parts: splitIntoParts(files, this.limits.partBytes),
    };
  }

  // The files of one part, a file at a time. A file gone since the plan
  // (past retention meanwhile) is left out.
  public async readPart(
    part: IArchiveFile[],
    slackTeamId: string,
  ): Promise<{ name: string; content: Buffer }[]> {
    const entries: { name: string; content: Buffer }[] = [];

    for (const { receiptId, name } of part) {
      const content = await this.files.get(receiptId, slackTeamId);

      if (content) {
        entries.push({ name, content });
      }
    }

    return entries;
  }

  // Images and PDFs are compressed already: stored, not deflated.
  public buildPart(entries: { name: string; content: Buffer }[]): Buffer {
    return Buffer.from(
      zipSync(
        Object.fromEntries(
          entries.map(({ name, content }) => [name, new Uint8Array(content)]),
        ),
        { level: 0 },
      ),
    );
  }
}
