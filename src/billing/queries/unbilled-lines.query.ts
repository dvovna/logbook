import { QueryCreator, sql } from 'kysely';
import { SqlDatabase } from '@common/types/sql-database.types';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';

export interface IUnbilledPeriod {
  slackTeamId: string;
  clientId: string;
  fromDate: string;
  toDate: string;
}

const RATE = sql<number | null>`coalesce(r.hourly_rate, p.hourly_rate)`;

// The lines a snapshot of the client's period would take now: the approved
// entries of the client's projects (archived ones too) in the period that
// are in no snapshot, each with its rate (the person's own on the project,
// else the project's) and the amount of its billable time. By project rather
// than the entry's client_id, which entries logged before it was filled in
// do not have. The amount is rounded to the cent per entry as amountInCents()
// rounds it (half up; rates and minutes are never negative), so that the
// lines add up to the totals.
export const unbilledLines = (
  db: QueryCreator<SqlDatabase>,
  { slackTeamId, clientId, fromDate, toDate }: IUnbilledPeriod,
) => {
  if (!slackTeamId) {
    throw new Error(
      '[billing_snapshot_entries] a query without a workspace ID',
    );
  }

  return db
    .selectFrom('time_entries as te')
    .innerJoin('projects as p', 'p.id', 'te.project_id')
    .leftJoin('project_user_rates as r', (join) =>
      join
        .onRef('r.project_id', '=', 'te.project_id')
        .onRef('r.user_id', '=', 'te.user_id'),
    )
    .where('te.slack_team_id', '=', slackTeamId)
    .where('p.slack_team_id', '=', slackTeamId)
    .where('p.client_id', '=', clientId)
    .where('te.status', '=', TimeEntryStatus.Approved)
    .where('te.deleted_at', 'is', null)
    .where('te.work_date', '>=', fromDate)
    .where('te.work_date', '<=', toDate)
    .where(({ not, exists, selectFrom }) =>
      not(
        exists(
          selectFrom('billing_snapshot_entries as bse')
            .select('bse.time_entry_id')
            .whereRef('bse.time_entry_id', '=', 'te.id'),
        ),
      ),
    )
    .select([
      'te.slack_team_id',
      'te.id as time_entry_id',
      'te.minutes',
      'te.billable',
      RATE.as('hourly_rate'),
      sql<
        number | null
      >`case when te.billable then round(${RATE} * 100 * te.minutes / 60) / 100 end`.as(
        'amount',
      ),
    ]);
};

// The lines added up, over a CTE of them named `picked`.
export const LINE_TOTALS = [
  sql<number>`count(*)::int`.as('entry_count'),
  sql<number>`coalesce(sum(minutes), 0)::int`.as('total_minutes'),
  sql<number>`coalesce(sum(minutes) filter (where billable), 0)::int`.as(
    'billable_minutes',
  ),
  sql<number>`coalesce(sum(amount), 0)`.as('total_amount'),
  sql<number>`coalesce(sum(minutes) filter (where billable and hourly_rate is null), 0)::int`.as(
    'unrated_minutes',
  ),
];
