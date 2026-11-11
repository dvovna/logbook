import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { toCents } from '@common/utils/money.utils';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import {
  IOpenPeriod,
  ISnapshotEntryStats,
  ISnapshotLine,
  ISnapshotTotals,
  IUnbilledClientTime,
} from 'src/billing/types/billing-snapshot.types';
import {
  IUnbilledPeriod,
  LINE_TOTALS,
  unbilledLines,
} from 'src/billing/queries/unbilled-lines.query';

const centsOrNull = (amount: number | null) =>
  amount === null ? null : toCents(amount);

// The lines of billing snapshots, one per time entry, and the queries about
// which approved time is billed.
@Injectable()
export class BillingSnapshotEntriesRepository extends BaseRepository<
  'billing_snapshot_entries',
  SqlRow<'billing_snapshot_entries'>
> {
  protected readonly tableName = 'billing_snapshot_entries';

  protected defaultOrderBy = ['time_entry_id:asc'];

  protected readonly uniqueOrder = ['time_entry_id:asc'];

  protected mapToViewModel = (row: SqlRow<'billing_snapshot_entries'>) => row;

  // Whether a snapshot of the client's period would take anything now.
  public async hasUnbilled(period: IUnbilledPeriod): Promise<boolean> {
    const row = await unbilledLines(this.db, period)
      .clearSelect()
      .select(sql<number>`1`.as('one'))
      .limit(1)
      .executeTakeFirst();

    return !!row;
  }

  // What a snapshot of the client's period would take now, added up as the
  // snapshot adds up its lines.
  public async unbilledTotals(
    period: IUnbilledPeriod,
  ): Promise<ISnapshotTotals> {
    const row = await this.db
      .with('picked', (db) => unbilledLines(db, period))
      .selectFrom('picked')
      .select(LINE_TOTALS)
      .executeTakeFirstOrThrow();

    return {
      entryCount: row.entry_count,
      totalMinutes: row.total_minutes,
      billableMinutes: row.billable_minutes,
      amountCents: toCents(row.total_amount),
      unratedMinutes: row.unrated_minutes,
    };
  }

  // Each snapshot's entries counted, by snapshot ID.
  public async statsBySnapshot(
    slackTeamId: string,
    snapshotIds: string[],
  ): Promise<Map<string, ISnapshotEntryStats>> {
    if (!snapshotIds.length) {
      return new Map();
    }

    const rows = await this.selectInWorkspace(slackTeamId)
      .where('snapshot_id', 'in', snapshotIds)
      .select([
        'snapshot_id',
        sql<number>`count(*)::int`.as('entry_count'),
        sql<number>`coalesce(sum(minutes) filter (where billable and hourly_rate is null), 0)::int`.as(
          'unrated_minutes',
        ),
      ])
      .groupBy('snapshot_id')
      .execute();

    return new Map(
      rows.map((row) => [
        row.snapshot_id,
        { entryCount: row.entry_count, unratedMinutes: row.unrated_minutes },
      ]),
    );
  }

  // The snapshot's lines with what their entries say: who, when, on what.
  public async findLines(
    slackTeamId: string,
    snapshotId: string,
  ): Promise<ISnapshotLine[]> {
    const rows = await this.db
      .selectFrom('billing_snapshot_entries as bse')
      .innerJoin('time_entries as te', 'te.id', 'bse.time_entry_id')
      .leftJoin('users as u', 'u.id', 'te.user_id')
      .leftJoin('teams as t', 't.id', 'te.team_id')
      .leftJoin('projects as p', 'p.id', 'te.project_id')
      .where('bse.slack_team_id', '=', this.requireWorkspace(slackTeamId))
      .where('bse.snapshot_id', '=', snapshotId)
      .select([
        'te.work_date',
        'te.description',
        'te.created_at',
        'u.name as person_name',
        'u.email',
        't.name as team_name',
        'p.name as project_name',
        'bse.minutes',
        'bse.billable',
        'bse.hourly_rate',
        'bse.amount',
      ])
      .execute();

    return rows.map((row) => ({
      workDate: row.work_date,
      personName: row.person_name,
      email: row.email,
      teamName: row.team_name,
      projectName: row.project_name,
      description: row.description,
      minutes: row.minutes,
      billable: row.billable,
      hourlyRate: row.hourly_rate,
      amountCents: centsOrNull(row.amount),
      createdAt: row.created_at,
    }));
  }

  // Each client's approved billable time of the period (no date is no limit)
  // that is in no snapshot, with its amount at today's rates: entry by entry, as a snapshot would bill it (the
  // person's own rate on the project, else the project's). Time on projects
  // without a client is left out: there is no one to bill.
  public async unbilledByClient(
    slackTeamId: string,
    { fromDate, toDate }: IOpenPeriod = {},
  ): Promise<IUnbilledClientTime[]> {
    const workspaceId = this.requireWorkspace(slackTeamId);
    let query = this.db
      .selectFrom('time_entries as te')
      .innerJoin('projects as p', 'p.id', 'te.project_id')
      .leftJoin('project_user_rates as r', (join) =>
        join
          .onRef('r.project_id', '=', 'te.project_id')
          .onRef('r.user_id', '=', 'te.user_id'),
      )
      .where('te.slack_team_id', '=', workspaceId)
      .where('p.slack_team_id', '=', workspaceId)
      .where('p.client_id', 'is not', null)
      .where('te.status', '=', TimeEntryStatus.Approved)
      .where('te.billable', '=', true)
      .where('te.deleted_at', 'is', null)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('billing_snapshot_entries as bse')
              .select('bse.time_entry_id')
              .whereRef('bse.time_entry_id', '=', 'te.id'),
          ),
        ),
      );

    if (fromDate) {
      query = query.where('te.work_date', '>=', fromDate);
    }

    if (toDate) {
      query = query.where('te.work_date', '<=', toDate);
    }

    const rows = await query
      .select([
        'p.client_id',
        sql<number>`sum(te.minutes)::int`.as('minutes'),
        sql<number>`coalesce(sum(round(coalesce(r.hourly_rate, p.hourly_rate) * 100 * te.minutes / 60)), 0)`.as(
          'amount_cents',
        ),
        sql<number>`coalesce(sum(te.minutes) filter (where coalesce(r.hourly_rate, p.hourly_rate) is null), 0)::int`.as(
          'unrated_minutes',
        ),
        sql<string>`min(te.work_date)::text`.as('since'),
      ])
      .groupBy('p.client_id')
      .execute();

    return rows.map((row) => ({
      clientId: row.client_id!,
      minutes: row.minutes,
      amountCents: Number(row.amount_cents),
      unratedMinutes: row.unrated_minutes,
      since: row.since,
    }));
  }

  private requireWorkspace(slackTeamId: string) {
    if (!slackTeamId) {
      throw new Error(
        '[billing_snapshot_entries] a query without a workspace ID',
      );
    }

    return slackTeamId;
  }
}
