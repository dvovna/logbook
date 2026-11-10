import { recordingDatabase } from 'src/database/testing/recording-database';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';

describe('BillingSnapshotEntriesRepository', () => {
  it('locks the approved entries of the period that no snapshot holds', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [
        {
          id: 'e1',
          user_id: 'u1',
          project_id: 'p1',
          minutes: 60,
          billable: true,
        },
      ],
    ]);

    const entries = await new BillingSnapshotEntriesRepository(
      database,
    ).findUnbilledApproved({
      slackTeamId: 'team-1',
      projectIds: ['p1', 'p2'],
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
      lock: true,
    });

    expect(entries).toHaveLength(1);
    expect(sqlOf(0)).toBe(
      'select "te"."id", "te"."user_id", "te"."project_id", "te"."minutes", "te"."billable" ' +
        'from "time_entries" as "te" ' +
        'where "te"."slack_team_id" = $1 and "te"."project_id" in ($2, $3) ' +
        'and "te"."status" = $4 and "te"."deleted_at" is null ' +
        'and "te"."work_date" >= $5 and "te"."work_date" <= $6 ' +
        'and not exists (select "bse"."time_entry_id" from "billing_snapshot_entries" as "bse" where "bse"."time_entry_id" = "te"."id") ' +
        'order by "te"."work_date", "te"."id" for update',
    );
    expect(parametersOf(0)).toEqual([
      'team-1',
      'p1',
      'p2',
      'approved',
      '2026-10-01',
      '2026-10-31',
    ]);
  });

  it('reads nothing for no projects', async () => {
    const { database, queries } = recordingDatabase();

    expect(
      await new BillingSnapshotEntriesRepository(database).findUnbilledApproved(
        {
          slackTeamId: 'team-1',
          projectIds: [],
          fromDate: '2026-10-01',
          toDate: '2026-10-31',
        },
      ),
    ).toEqual([]);
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
