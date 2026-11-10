import { Injectable } from '@nestjs/common';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { assertCanManageSnapshots } from 'src/billing/constants/snapshot-roles';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import { IOpenPeriod } from 'src/billing/types/billing-snapshot.types';
import { assertOpenPeriod } from 'src/time-entries/utils/report-period';

// A client's approved billable time that isn't invoiced yet.
export interface IUninvoicedRow {
  clientName: string;
  // In no snapshot: its amount at today's rates, in cents, and the
  // billable time without a rate, which has none.
  minutes: number;
  amountCents: number;
  unratedMinutes: number;
  // The earliest day of it; null when all of it is in snapshots.
  since: string | null;
  // In snapshots not marked invoiced yet, at the rates they froze.
  snapshotMinutes: number;
  snapshotAmountCents: number;
  snapshotCount: number;
}

// No date is no limit: both empty is all time.
export type IUninvoicedPeriod = IOpenPeriod;

export interface IUninvoicedReport extends IUninvoicedPeriod {
  currency: string;
  // Most time not in a snapshot first.
  rows: IUninvoicedRow[];
  total: Omit<IUninvoicedRow, 'clientName' | 'since'>;
}

const emptyRow = (clientName: string): IUninvoicedRow => ({
  clientName,
  minutes: 0,
  amountCents: 0,
  unratedMinutes: 0,
  since: null,
  snapshotMinutes: 0,
  snapshotAmountCents: 0,
  snapshotCount: 0,
});

// What hasn't been invoiced, per client, in a period (all time by default):
// approved billable time in no billing snapshot yet (at today's rates, entry
// by entry, as a snapshot would bill it), and the time in snapshots that
// aren't marked invoiced. Admin and Finance only.
@Injectable()
export class UninvoicedReportService {
  public constructor(
    private readonly entriesRepository: BillingSnapshotEntriesRepository,
    private readonly snapshotsRepository: BillingSnapshotsRepository,
    private readonly clientsService: ClientsService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  public async getReport(
    user: IUserViewModel,
    { fromDate, toDate }: IUninvoicedPeriod = {},
  ): Promise<IUninvoicedReport> {
    assertCanManageSnapshots(user);
    assertOpenPeriod(fromDate, toDate);

    const period = {
      ...(fromDate ? { fromDate } : {}),
      ...(toDate ? { toDate } : {}),
    };
    const slackTeamId = user.slack_team_id;
    const [unbilled, notInvoiced, clients, currency] = await Promise.all([
      this.entriesRepository.unbilledByClient(slackTeamId, period),
      this.snapshotsRepository.notInvoicedByClient(slackTeamId, period),
      this.clientsService.findMany({ slackTeamId, includeArchived: true }),
      this.slackTeamsService.getCurrency(slackTeamId),
    ]);
    const names = new Map(clients.map(({ id, name }) => [id, name]));
    const rows = new Map<string, IUninvoicedRow>();
    const rowOf = (clientId: string) => {
      const row =
        rows.get(clientId) ?? emptyRow(names.get(clientId) ?? 'Unknown client');

      rows.set(clientId, row);

      return row;
    };

    for (const time of unbilled) {
      Object.assign(rowOf(time.clientId), {
        minutes: time.minutes,
        amountCents: time.amountCents,
        unratedMinutes: time.unratedMinutes,
        since: time.since,
      });
    }

    for (const time of notInvoiced) {
      Object.assign(rowOf(time.clientId), {
        snapshotMinutes: time.billableMinutes,
        snapshotAmountCents: time.amountCents,
        snapshotCount: time.snapshotCount,
      });
    }

    const sorted = [...rows.values()].sort(
      (a, b) =>
        b.minutes - a.minutes ||
        b.snapshotMinutes - a.snapshotMinutes ||
        a.clientName.localeCompare(b.clientName),
    );
    const sum = (valueOf: (row: IUninvoicedRow) => number) =>
      sorted.reduce((total, row) => total + valueOf(row), 0);

    return {
      ...period,
      currency,
      rows: sorted,
      total: {
        minutes: sum(({ minutes }) => minutes),
        amountCents: sum(({ amountCents }) => amountCents),
        unratedMinutes: sum(({ unratedMinutes }) => unratedMinutes),
        snapshotMinutes: sum(({ snapshotMinutes }) => snapshotMinutes),
        snapshotAmountCents: sum(
          ({ snapshotAmountCents }) => snapshotAmountCents,
        ),
        snapshotCount: sum(({ snapshotCount }) => snapshotCount),
      },
    };
  }
}
