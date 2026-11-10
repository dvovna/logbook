import { Injectable } from '@nestjs/common';
import { csvText, toCsv } from '@common/utils/csv.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import {
  IBillingSnapshot,
  ISnapshotLine,
} from 'src/billing/types/billing-snapshot.types';

export interface ISnapshotCsv {
  snapshot: IBillingSnapshot;
  filename: string;
  content: string;
}

// One client, all approved: so no Client or Status column, unlike the time
// report's CSV. Rate and Amount are the ones the snapshot froze.
const COLUMNS = [
  'Date',
  'Person',
  'Email',
  'Team',
  'Project',
  'Description',
  'Hours',
  'Billable',
  'Rate',
  'Amount',
  'Currency',
];

// 15-minute steps: two decimals are exact.
const hours = (minutes: number) => (minutes / 60).toFixed(2);

const money = (cents: number) => (cents / 100).toFixed(2);

// "Acme Corp." -> "acme-corp", for a file name; "client" when nothing is left.
const slug = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'client';

const byDatePersonProject = (a: ISnapshotLine, b: ISnapshotLine) =>
  a.workDate.localeCompare(b.workDate) ||
  (a.personName ?? '').localeCompare(b.personName ?? '') ||
  (a.projectName ?? '').localeCompare(b.projectName ?? '') ||
  a.createdAt.localeCompare(b.createdAt);

// A billing snapshot as a CSV file for accounting, one line per entry, with
// the rate and amount it was billed at. Admin and HR only
// (BillingSnapshotsService.findOne checks).
@Injectable()
export class BillingSnapshotExportService {
  public constructor(
    private readonly snapshotsService: BillingSnapshotsService,
    private readonly entriesRepository: BillingSnapshotEntriesRepository,
  ) {}

  public async getCsv(id: string, user: IUserViewModel): Promise<ISnapshotCsv> {
    const snapshot = await this.snapshotsService.findOne(id, user);
    const lines = await this.entriesRepository.findLines(
      user.slack_team_id,
      snapshot.id,
    );

    const rows = lines
      .sort(byDatePersonProject)
      .map((line) => [
        line.workDate,
        csvText(line.personName),
        csvText(line.email),
        csvText(line.teamName),
        csvText(line.projectName),
        csvText(line.description),
        hours(line.minutes),
        line.billable ? 'yes' : 'no',
        line.hourlyRate === null ? '' : line.hourlyRate.toFixed(2),
        line.amountCents === null ? '' : money(line.amountCents),
        snapshot.currency,
      ]);

    return {
      snapshot,
      filename: `billing-${slug(snapshot.client?.name ?? '')}-${snapshot.period_start}-to-${snapshot.period_end}.csv`,
      content: toCsv([COLUMNS, ...rows]),
    };
  }
}
