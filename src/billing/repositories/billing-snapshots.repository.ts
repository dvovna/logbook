import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import {
  BaseRepository,
  IRelation,
} from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { toCents } from '@common/utils/money.utils';
import {
  IBillingSnapshotViewModel,
  INotInvoicedClientTime,
  IOpenPeriod,
} from 'src/billing/types/billing-snapshot.types';

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
