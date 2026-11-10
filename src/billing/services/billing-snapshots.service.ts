import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { ISearchResult } from '@common/types/pagination.types';
import { formatDateRange } from '@common/utils/date.utils';
import { amountInCents } from '@common/utils/money.utils';
import ClientsService from '@modules/clients/services/clients.service';
import IClientViewModel from '@modules/clients/types/client.interface';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TransactionService } from 'src/database/transaction.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { rateOf } from 'src/time-entries/services/time-report.service';
import { assertReportPeriod } from 'src/time-entries/utils/report-period';
import {
  assertCanManageSnapshots,
  assertCanUnlockSnapshots,
} from 'src/billing/constants/snapshot-roles';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import {
  IBillingSnapshot,
  IBillingSnapshotViewModel,
  ISnapshotLineInsert,
} from 'src/billing/types/billing-snapshot.types';

export interface ISnapshotParams {
  user: IUserViewModel;
  clientId: string;
  fromDate: string;
  toDate: string;
}

// What a snapshot of a client's period holds, or would hold now.
export interface ISnapshotPreview {
  clientName: string;
  fromDate: string;
  toDate: string;
  currency: string;
  entryCount: number;
  totalMinutes: number;
  billableMinutes: number;
  // Of the billable time with a rate, in cents.
  amountCents: number;
  // Billable time without a rate, so without an amount.
  unratedMinutes: number;
}

const NO_SUCH_SNAPSHOT = 'This snapshot no longer exists.';

// Billing snapshots: a client's approved time of a period, locked with the
// rate and amount of each entry, for an invoice made elsewhere. A snapshot
// takes the approved entries of the client's projects (archived ones too) in
// the period that are in no other snapshot, so a second snapshot of the same
// period takes only what was approved since. While an entry is in a
// snapshot, nobody changes it (time_entries_keep_billed); an admin unlocks
// the snapshot by deleting it, which frees its entries. Admin and HR create
// snapshots and mark them invoiced; every method checks the role and that
// the IDs, which come from the client, are the workspace's.
@Injectable()
export class BillingSnapshotsService {
  public constructor(
    private readonly snapshotsRepository: BillingSnapshotsRepository,
    private readonly entriesRepository: BillingSnapshotEntriesRepository,
    private readonly transactions: TransactionService,
    private readonly clientsService: ClientsService,
    private readonly projectsService: ProjectsService,
    private readonly projectRatesService: ProjectRatesService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  // What a snapshot of the client's period would hold if made now.
  public async preview(params: ISnapshotParams): Promise<ISnapshotPreview> {
    const { client, currency, lines } = await this.collect(params);

    return this.toPreview(params, client, currency, lines);
  }

  // Locks the client's approved time of the period that is in no snapshot
  // yet, at today's rates. One transaction: the entries are locked (FOR
  // UPDATE) as they are read, so none changes before the snapshot commits,
  // and snapshots of one workspace are made one at a time.
  public async create(params: ISnapshotParams): Promise<IBillingSnapshot> {
    const { user } = params;

    return this.transactions.transaction(async () => {
      await this.transactions.lock(`billing-snapshots:${user.slack_team_id}`);

      const { client, currency, lines } = await this.collect(params, {
        lock: true,
      });
      const totals = this.toPreview(params, client, currency, lines);

      if (!lines.length) {
        throw new ValidationError(
          `No approved time of ${client.name} in ${formatDateRange(params.fromDate, params.toDate)} is left outside snapshots.`,
        );
      }

      const snapshot = await this.snapshotsRepository.create({
        slack_team_id: user.slack_team_id,
        client_id: client.id,
        period_start: params.fromDate,
        period_end: params.toDate,
        currency,
        total_minutes: totals.totalMinutes,
        billable_minutes: totals.billableMinutes,
        total_amount: totals.amountCents / 100,
        created_at: new Date().toISOString(),
        created_by: user.id,
      });

      await this.entriesRepository.insertLines(
        user.slack_team_id,
        snapshot.id,
        lines,
      );

      return {
        ...snapshot,
        entryCount: totals.entryCount,
        unratedMinutes: totals.unratedMinutes,
      };
    });
  }

  // The workspace's snapshots, a client's only if `clientId` is given,
  // newest first.
  public async search(
    user: IUserViewModel,
    {
      page,
      pageSize,
      clientId,
    }: { page?: number; pageSize: number; clientId?: string },
  ): Promise<ISearchResult<IBillingSnapshot>> {
    assertCanManageSnapshots(user);

    const result = await this.snapshotsRepository.search({
      filters: {
        slack_team_id: user.slack_team_id,
        ...(clientId ? { client_id: clientId } : {}),
      },
      page,
      pageSize,
      orderBy: ['created_at:desc'],
    });

    return { ...result, items: await this.withStats(user, result.items) };
  }

  public async findOne(id: string, user: IUserViewModel) {
    assertCanManageSnapshots(user);

    const snapshot = await this.snapshotsRepository.findOne({
      id,
      slack_team_id: user.slack_team_id,
    });

    if (!snapshot) {
      throw new ValidationError(NO_SUCH_SNAPSHOT);
    }

    const [withStats] = await this.withStats(user, [snapshot]);

    return withStats;
  }

  // Marks the snapshot invoiced, once.
  public async markInvoiced(
    id: string,
    user: IUserViewModel,
  ): Promise<IBillingSnapshot> {
    const snapshot = await this.findOne(id, user);
    const marked = await this.snapshotsRepository.markInvoiced(
      user.slack_team_id,
      id,
      user.id,
    );

    if (!marked) {
      throw new ValidationError(
        snapshot.invoiced_at
          ? 'This snapshot is already marked invoiced.'
          : NO_SUCH_SNAPSHOT,
      );
    }

    return this.findOne(id, user);
  }

  // Takes the invoiced mark off, e.g. one set by mistake; Admin and HR, as
  // marking. The snapshot stays locked.
  public async markNotInvoiced(
    id: string,
    user: IUserViewModel,
  ): Promise<IBillingSnapshot> {
    await this.findOne(id, user);

    if (
      !(await this.snapshotsRepository.unmarkInvoiced(user.slack_team_id, id))
    ) {
      throw new ValidationError("This snapshot isn't marked invoiced.");
    }

    return this.findOne(id, user);
  }

  // Deletes the snapshot, an invoiced one too: its entries can change again,
  // and count as uninvoiced. An admin's only. Returns what it was.
  public async unlock(
    id: string,
    user: IUserViewModel,
  ): Promise<IBillingSnapshot> {
    assertCanUnlockSnapshots(user);

    const snapshot = await this.findOne(id, user);

    if (!(await this.snapshotsRepository.deleteOne(user.slack_team_id, id))) {
      throw new ValidationError(NO_SUCH_SNAPSHOT);
    }

    return snapshot;
  }

  private async withStats(
    user: IUserViewModel,
    snapshots: IBillingSnapshotViewModel[],
  ): Promise<IBillingSnapshot[]> {
    const stats = await this.entriesRepository.statsBySnapshot(
      user.slack_team_id,
      snapshots.map(({ id }) => id),
    );

    return snapshots.map((snapshot) => ({
      ...snapshot,
      ...(stats.get(snapshot.id) ?? { entryCount: 0, unratedMinutes: 0 }),
    }));
  }

  // The lines a snapshot of the period would hold: the client's approved
  // entries in no snapshot, each with its rate (the person's own on the
  // project, else the project's) and the amount of its billable time.
  private async collect(
    { user, clientId, fromDate, toDate }: ISnapshotParams,
    { lock = false }: { lock?: boolean } = {},
  ): Promise<{
    client: IClientViewModel;
    currency: string;
    lines: ISnapshotLineInsert[];
  }> {
    assertCanManageSnapshots(user);
    assertReportPeriod(fromDate, toDate);

    const slackTeamId = user.slack_team_id;
    const client = await this.clientsService.findOne({
      id: clientId,
      slackTeamId,
      includeArchived: true,
    });

    if (!client) {
      throw new ValidationError('Client not found.');
    }

    // By project rather than the entry's client_id, which entries logged
    // before it was filled in do not have (as the billing report does).
    const projects = await this.projectsService.findMany({
      slackTeamId,
      clientId,
      includeArchived: true,
    });
    const projectIds = projects.map(({ id }) => id);
    const entries = await this.entriesRepository.findUnbilledApproved({
      slackTeamId,
      projectIds,
      fromDate,
      toDate,
      lock,
    });
    const rates: Map<string, IProjectRates> = entries.length
      ? await this.projectRatesService.findRates(projectIds, user)
      : new Map();
    const currency = await this.slackTeamsService.getCurrency(slackTeamId);

    const lines = entries.map((entry): ISnapshotLineInsert => {
      const hourlyRate = rateOf(rates, entry.project_id, entry.user_id);

      return {
        timeEntryId: entry.id,
        minutes: entry.minutes,
        billable: entry.billable,
        hourlyRate,
        amountCents:
          entry.billable && hourlyRate !== null
            ? amountInCents(entry.minutes, hourlyRate)
            : null,
      };
    });

    return { client, currency, lines };
  }

  private toPreview(
    { fromDate, toDate }: ISnapshotParams,
    client: IClientViewModel,
    currency: string,
    lines: ISnapshotLineInsert[],
  ): ISnapshotPreview {
    const billable = lines.filter(({ billable }) => billable);
    const sum = (items: ISnapshotLineInsert[]) =>
      items.reduce((total, { minutes }) => total + minutes, 0);

    return {
      clientName: client.name,
      fromDate,
      toDate,
      currency,
      entryCount: lines.length,
      totalMinutes: sum(lines),
      billableMinutes: sum(billable),
      amountCents: billable.reduce(
        (total, { amountCents }) => total + (amountCents ?? 0),
        0,
      ),
      unratedMinutes: sum(
        billable.filter(({ hourlyRate }) => hourlyRate === null),
      ),
    };
  }
}
