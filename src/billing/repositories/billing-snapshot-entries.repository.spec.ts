import { recordingDatabase } from 'src/database/testing/recording-database';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';

describe('BillingSnapshotEntriesRepository', () => {
  const PERIOD = {
    slackTeamId: 'team-1',
    clientId: 'acme',
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
  };

  // The lines a snapshot of PERIOD would take (unbilledLines).
  const UNBILLED_LINES =
    'from "time_entries" as "te" ' +
    'inner join "projects" as "p" on "p"."id" = "te"."project_id" ' +
    'left join "project_user_rates" as "r" on "r"."project_id" = "te"."project_id" and "r"."user_id" = "te"."user_id" ' +
    'where "te"."slack_team_id" = $1 and "p"."slack_team_id" = $2 and "p"."client_id" = $3 ' +
    'and "te"."status" = $4 and "te"."deleted_at" is null ' +
    'and "te"."work_date" >= $5 and "te"."work_date" <= $6 ' +
    'and not exists (select "bse"."time_entry_id" from "billing_snapshot_entries" as "bse" where "bse"."time_entry_id" = "te"."id")';

  it("tells whether approved time of the client's period is left outside snapshots", async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ one: 1 }],
      [],
    ]);
    const repository = new BillingSnapshotEntriesRepository(database);

    expect(await repository.hasUnbilled(PERIOD)).toBe(true);
    expect(await repository.hasUnbilled(PERIOD)).toBe(false);
    expect(sqlOf(0)).toBe(`select 1 as "one" ${UNBILLED_LINES} limit $7`);
    expect(parametersOf(0)).toEqual([
      'team-1',
      'team-1',
      'acme',
      'approved',
      '2026-10-01',
      '2026-10-31',
      1,
    ]);
  });

  it('adds up what a snapshot would take as the snapshot does, rounding each entry', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [
        {
          entry_count: 2,
          total_minutes: 90,
          billable_minutes: 60,
          total_amount: 100.01,
          unrated_minutes: 15,
        },
      ],
    ]);

    expect(
      await new BillingSnapshotEntriesRepository(database).unbilledTotals(
        PERIOD,
      ),
    ).toEqual({
      entryCount: 2,
      totalMinutes: 90,
      billableMinutes: 60,
      amountCents: 10001,
      unratedMinutes: 15,
    });
    expect(sqlOf(0)).toBe(
      'with "picked" as (select "te"."slack_team_id", "te"."id" as "time_entry_id", "te"."minutes", "te"."billable", ' +
        'coalesce(r.hourly_rate, p.hourly_rate) as "hourly_rate", ' +
        'case when te.billable then round(coalesce(r.hourly_rate, p.hourly_rate) * 100 * te.minutes / 60) / 100 end as "amount" ' +
        `${UNBILLED_LINES}) ` +
        'select count(*)::int as "entry_count", coalesce(sum(minutes), 0)::int as "total_minutes", ' +
        'coalesce(sum(minutes) filter (where billable), 0)::int as "billable_minutes", ' +
        'coalesce(sum(amount), 0) as "total_amount", ' +
        'coalesce(sum(minutes) filter (where billable and hourly_rate is null), 0)::int as "unrated_minutes" ' +
        'from "picked"',
    );
    expect(parametersOf(0)).toEqual([
      'team-1',
      'team-1',
      'acme',
      'approved',
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('refuses to add up time without a workspace', async () => {
    const { database, queries } = recordingDatabase();

    await expect(
      new BillingSnapshotEntriesRepository(database).unbilledTotals({
        ...PERIOD,
        slackTeamId: '',
      }),
    ).rejects.toThrow('a query without a workspace ID');
    expect(queries).toHaveLength(0);
  });

  it("adds up each client's unbilled time entry by entry, at today's rates", async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [
        {
          client_id: 'c1',
          minutes: 90,
          amount_cents: '15000',
          unrated_minutes: 0,
          since: '2026-09-01',
        },
      ],
    ]);

    const rows = await new BillingSnapshotEntriesRepository(
      database,
    ).unbilledByClient('team-1');

    expect(rows).toEqual([
      {
        clientId: 'c1',
        minutes: 90,
        amountCents: 15000,
        unratedMinutes: 0,
        since: '2026-09-01',
      },
    ]);
    expect(sqlOf(0)).toContain(
      'sum(round(coalesce(r.hourly_rate, p.hourly_rate) * 100 * te.minutes / 60))',
    );
    expect(sqlOf(0)).toContain(
      'left join "project_user_rates" as "r" on "r"."project_id" = "te"."project_id" and "r"."user_id" = "te"."user_id"',
    );
    expect(sqlOf(0)).toContain('group by "p"."client_id"');
    expect(parametersOf(0)).toEqual(['team-1', 'team-1', 'approved', true]);
  });

  it('refuses a query without a workspace', async () => {
    const { database } = recordingDatabase();

    await expect(
      new BillingSnapshotEntriesRepository(database).unbilledByClient(''),
    ).rejects.toThrow('a query without a workspace ID');
  });
});
