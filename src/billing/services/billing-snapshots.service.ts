import { billingSnapshotsLock } from 'src/database/advisory-locks';
import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { ISearchResult } from '@common/types/pagination.types';
import { formatDateRange } from '@common/utils/date.utils';
import ClientsService from '@modules/clients/services/clients.service';
import IClientViewModel from '@modules/clients/types/client.interface';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TransactionService } from 'src/database/transaction.service';
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
  ISnapshotTotals,
} from 'src/billing/types/billing-snapshot.types';

export interface ISnapshotParams {
  user: IUserViewModel;
  clientId: string;
  fromDate: string;
  toDate: string;
}

// What a snapshot of a client's period would hold now.
export interface ISnapshotPreview extends ISnapshotTotals {
  clientName: string;
  fromDate: string;
  toDate: string;
  currency: string;
}

const NO_SUCH_SNAPSHOT = 'This snapshot no longer exists.';

const assertCanSnapshot = ({ user, fromDate, toDate }: ISnapshotParams) => {
  assertCanManageSnapshots(user);
  assertReportPeriod(fromDate, toDate);
};

const nothingLeft = (
  client: IClientViewModel,
  { fromDate, toDate }: ISnapshotParams,
) =>
  new ValidationError(
    `No approved time of ${client.name} in ${formatDateRange(fromDate, toDate)} is left outside snapshots.`,
  );

// Billing snapshots: a client's approved time of a period, locked with the
// rate and amount of each entry, for an invoice made elsewhere. A snapshot
// takes the approved entries of the client's projects (archived ones too) in
// the period that are in no other snapshot, so a second snapshot of the same
// period takes only what was approved since. While an entry is in a
// snapshot, nobody changes it (time_entries_keep_billed); an admin unlocks
// the snapshot by deleting it, which frees its entries. Admin and Finance create
// snapshots and mark them invoiced; every method checks the role and that
// the IDs, which come from the client, are the workspace's.
@Injectable()
export class BillingSnapshotsService {
  public constructor(
    private readonly snapshotsRepository: BillingSnapshotsRepository,
    private readonly entriesRepository: BillingSnapshotEntriesRepository,
    private readonly transactions: TransactionService,
    private readonly clientsService: ClientsService,
    private readonly slackTeamsService: SlackTeamsService,
  ) {}

  // What a snapshot of the client's period would hold if made now, worked
  // out as create() works it out.
  public async preview(params: ISnapshotParams): Promise<ISnapshotPreview> {
    assertCanSnapshot(params);

    const [client, currency, totals] = await Promise.all([
      this.findClient(params),
      this.slackTeamsService.getCurrency(params.user.slack_team_id),
      this.entriesRepository.unbilledTotals(this.periodOf(params)),
    ]);

    return {
      clientName: client.name,
      fromDate: params.fromDate,
      toDate: params.toDate,
      currency,
      ...totals,
    };
  }

  // The checks of create() that are quick, for the form to show before
  // Slack's answer: the role, the period, the client, and that something is
  // left to lock. create() makes them again.
  public async assertCanCreate(params: ISnapshotParams): Promise<void> {
    assertCanSnapshot(params);

    const [client, hasUnbilled] = await Promise.all([
      this.findClient(params),
      this.entriesRepository.hasUnbilled(this.periodOf(params)),
    ]);

    if (!hasUnbilled) {
      throw nothingLeft(client, params);
    }
  }

  // Locks the client's approved time of the period that is in no snapshot
  // yet, at today's rates, in one statement (createFromUnbilled), which
  // locks the entries it takes (FOR UPDATE) until the snapshot commits.
  // Snapshots of one workspace are made one at a time: a second one waits
  // for the first, then takes only what the first left.
  public async create(params: ISnapshotParams): Promise<IBillingSnapshot> {
    const { user } = params;

    assertCanSnapshot(params);

    const [client, currency] = await Promise.all([
      this.findClient(params),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);

    return this.transactions.transaction(async () => {
      await this.transactions.lock(billingSnapshotsLock(user.slack_team_id));

      const snapshot = await this.snapshotsRepository.createFromUnbilled({
        ...this.periodOf(params),
        currency,
        createdBy: user.id,
      });

      if (!snapshot) {
        throw nothingLeft(client, params);
      }

      return snapshot;
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

  // Takes the invoiced mark off, e.g. one set by mistake; Admin and Finance, as
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

  // The client of the snapshot: the workspace's, archived ones too.
  private async findClient({
    user,
    clientId,
  }: ISnapshotParams): Promise<IClientViewModel> {
    const client = await this.clientsService.findOne({
      id: clientId,
      slackTeamId: user.slack_team_id,
      includeArchived: true,
    });

    if (!client) {
      throw new ValidationError('Client not found.');
    }

    return client;
  }

  private periodOf({ user, clientId, fromDate, toDate }: ISnapshotParams) {
    return { slackTeamId: user.slack_team_id, clientId, fromDate, toDate };
  }
}
