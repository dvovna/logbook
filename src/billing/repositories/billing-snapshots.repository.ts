import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BaseRepository,
  IRelation,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { toCents } from '@common/utils/money.utils';
import {
  IBillingSnapshot,
  IBillingSnapshotViewModel,
  INewSnapshot,
  INotInvoicedClientTime,
  IOpenPeriod,
} from 'src/billing/types/billing-snapshot.types';
import {
  LINE_TOTALS,
  unbilledLines,
} from 'src/billing/queries/unbilled-lines.query';

type Named = { id: string; name: string } | null | undefined;

const named = (value: Named) =>
  value ? { id: value.id, name: value.name } : null;

@Injectable()
export class BillingSnapshotsRepository extends BaseRepository<
  'billing_snapshots',
  IBillingSnapshotViewModel
> {
  protected readonly tableName = 'billing_snapshots';

  protected relations: Record<string, IRelation> = {
    client: {
      table: 'clients',
      foreignKey: 'client_id',
      columns: ['id', 'name'],
    },
    creator: {
      table: 'users',
      foreignKey: 'created_by',
      columns: ['id', 'name'],
    },
    invoicer: {
      table: 'users',
      foreignKey: 'invoiced_by',
      columns: ['id', 'name'],
    },
  };

  protected mapToViewModel = (row: SqlRow<'billing_snapshots'>) => {
    const { client, creator, invoicer } = row as SqlRow<'billing_snapshots'> & {
      client?: Named;
      creator?: Named;
      invoicer?: Named;
    };

    return {
      id: row.id,
      slack_team_id: row.slack_team_id,
      client_id: row.client_id,
      client: named(client),
      period_start: row.period_start,
      period_end: row.period_end,
      currency: row.currency,
      total_minutes: row.total_minutes,
      billable_minutes: row.billable_minutes,
      total_amount_cents: toCents(row.total_amount),
      created_at: row.created_at,
      created_by: row.created_by,
      creator: named(creator),
      invoiced_at: row.invoiced_at,
      invoiced_by: row.invoiced_by,
      invoicer: named(invoicer),
    };
  };

  // Makes a snapshot of the client's approved time of the period that no
  // snapshot holds, in one statement: it reads the lines (unbilledLines)
  // with their entries locked (FOR UPDATE), so that none of them changes
  // before the snapshot commits, stores their sums as the snapshot's totals
  // and writes the lines. Null, and nothing written, when there was nothing
  // to take.
  public async createFromUnbilled({
    currency,
    createdBy,
    ...period
  }: INewSnapshot): Promise<IBillingSnapshot | null> {
    const row = await this.db
      .with('picked', (db) => unbilledLines(db, period).forUpdate('te'))
      .with('totals', (db) => db.selectFrom('picked').select(LINE_TOTALS))
      .with('snapshot', (db) =>
        db
          .insertInto('billing_snapshots')
          .columns([
            'slack_team_id',
            'client_id',
            'period_start',
            'period_end',
            'currency',
            'total_minutes',
            'billable_minutes',
            'total_amount',
            'created_at',
            'created_by',
          ])
          .expression((eb) =>
            eb
              .selectFrom('totals')
              .select([
                eb.val(period.slackTeamId).as('slack_team_id'),
                eb.val(period.clientId).as('client_id'),
                eb.val(period.fromDate).as('period_start'),
                eb.val(period.toDate).as('period_end'),
                eb.val(currency).as('currency'),
                'totals.total_minutes',
                'totals.billable_minutes',
                'totals.total_amount',
                eb.val(new Date().toISOString()).as('created_at'),
                eb.val(createdBy).as('created_by'),
              ])
              .where('totals.entry_count', '>', 0),
          )
          .returningAll(),
      )
      .with('lines', (db) =>
        db
          .insertInto('billing_snapshot_entries')
          .columns([
            'slack_team_id',
            'snapshot_id',
            'time_entry_id',
            'minutes',
            'billable',
            'hourly_rate',
            'amount',
          ])
          .expression((eb) =>
            eb
              .selectFrom('picked')
              .crossJoin('snapshot')
              .select([
                'picked.slack_team_id',
                'snapshot.id',
                'picked.time_entry_id',
                'picked.minutes',
                'picked.billable',
                'picked.hourly_rate',
                'picked.amount',
              ]),
          ),
      )
      .selectFrom('snapshot')
      .crossJoin('totals')
      .selectAll('snapshot')
      .select((eb) => [
        ...this.relationColumns(eb as never, 'snapshot'),
        'totals.entry_count',
        'totals.unrated_minutes',
      ])
      .executeTakeFirst();

    return row
      ? {
          ...this.mapToViewModel(row as never),
          entryCount: row.entry_count,
          unratedMinutes: row.unrated_minutes,
        }
      : null;
  }

  // Marks the snapshot invoiced unless it already is: true when this call
  // did, so two people marking it at once don't both succeed.
  public async markInvoiced(
    slackTeamId: string,
    id: string,
    userId: string,
  ): Promise<boolean> {
    const row = await this.updateInWorkspace(slackTeamId)
      .set({ invoiced_at: new Date().toISOString(), invoiced_by: userId })
      .where('id', '=', id)
      .where('invoiced_at', 'is', null)
      .returning('id')
      .executeTakeFirst();

    return !!row;
  }

  // Takes the invoiced mark off a snapshot that has it: true when this call
  // did.
  public async unmarkInvoiced(
    slackTeamId: string,
    id: string,
  ): Promise<boolean> {
    const row = await this.updateInWorkspace(slackTeamId)
      .set({ invoiced_at: null, invoiced_by: null })
      .where('id', '=', id)
      .where('invoiced_at', 'is not', null)
      .returning('id')
      .executeTakeFirst();

    return !!row;
  }

  // Deletes the snapshot and, through the cascade, its lines: true when this
  // call did.
  public async deleteOne(slackTeamId: string, id: string): Promise<boolean> {
    const row = await this.deleteInWorkspace(slackTeamId)
      .where('id', '=', id)
      .returning('id')
      .executeTakeFirst();

    return !!row;
  }

  // Each client's billable time in snapshots that aren't marked invoiced,
  // at the amounts they froze: the lines whose entries are in the period
  // (no date is no limit).
  public async notInvoicedByClient(
    slackTeamId: string,
    { fromDate, toDate }: IOpenPeriod = {},
  ): Promise<INotInvoicedClientTime[]> {
    if (!slackTeamId) {
      throw new Error('[billing_snapshots] a query without a workspace ID');
    }

    let query = this.db
      .selectFrom('billing_snapshot_entries as bse')
      .innerJoin('billing_snapshots as s', 's.id', 'bse.snapshot_id')
      .innerJoin('time_entries as te', 'te.id', 'bse.time_entry_id')
      .where('s.slack_team_id', '=', slackTeamId)
      .where('s.invoiced_at', 'is', null)
      .where('bse.billable', '=', true);

    if (fromDate) {
      query = query.where('te.work_date', '>=', fromDate);
    }

    if (toDate) {
      query = query.where('te.work_date', '<=', toDate);
    }

    const rows = await query
      .select([
        's.client_id',
        sql<number>`count(distinct s.id)::int`.as('snapshot_count'),
        sql<number>`sum(bse.minutes)::int`.as('billable_minutes'),
        sql<number>`coalesce(sum(bse.amount), 0)`.as('total_amount'),
      ])
      .groupBy('s.client_id')
      .execute();

    return rows.map((row) => ({
      clientId: row.client_id,
      snapshotCount: row.snapshot_count,
      billableMinutes: row.billable_minutes,
      amountCents: toCents(row.total_amount),
    }));
  }
}
