import { recordingDatabase } from 'src/database/testing/recording-database';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';

const NEW_SNAPSHOT = {
  slackTeamId: 'team-1',
  clientId: 'acme',
  fromDate: '2026-10-01',
  toDate: '2026-10-31',
  currency: 'EUR',
  createdBy: 'actor',
};

describe('BillingSnapshotsRepository', () => {
  it('makes a snapshot and its lines in one statement, with the entries locked', async () => {
    const { database, queries, sqlOf, parametersOf } = recordingDatabase([
      [
        {
          id: 'snapshot-1',
          slack_team_id: 'team-1',
          client_id: 'acme',
          client: { id: 'acme', name: 'Acme' },
          period_start: '2026-10-01',
          period_end: '2026-10-31',
          currency: 'EUR',
          total_minutes: 90,
          billable_minutes: 60,
          total_amount: 100.01,
          created_at: '2026-11-11T10:00:00.000000+00:00',
          created_by: 'actor',
          creator: { id: 'actor', name: 'Ann' },
          invoiced_at: null,
          invoiced_by: null,
          invoicer: null,
          entry_count: 2,
          unrated_minutes: 15,
        },
      ],
    ]);

    const snapshot = await new BillingSnapshotsRepository(
      database,
    ).createFromUnbilled(NEW_SNAPSHOT);

    expect(snapshot).toMatchObject({
      id: 'snapshot-1',
      client: { id: 'acme', name: 'Acme' },
      total_minutes: 90,
      total_amount_cents: 10001,
      creator: { id: 'actor', name: 'Ann' },
      entryCount: 2,
      unratedMinutes: 15,
    });
    expect(queries).toHaveLength(1);

    const sql = sqlOf(0);

    expect(sql).toMatch(/^with "picked" as \(select .* for update of "te"\), /);
    expect(sql).toContain(
      '"totals" as (select count(*)::int as "entry_count", coalesce(sum(minutes), 0)::int as "total_minutes", ',
    );
    expect(sql).toContain(
      '"snapshot" as (insert into "billing_snapshots" ("slack_team_id", "client_id", "period_start", "period_end", "currency", "total_minutes", "billable_minutes", "total_amount", "created_at", "created_by") ' +
        'select $7 as "slack_team_id", $8 as "client_id", $9 as "period_start", $10 as "period_end", $11 as "currency", ' +
        '"totals"."total_minutes", "totals"."billable_minutes", "totals"."total_amount", $12 as "created_at", $13 as "created_by" ' +
        'from "totals" where "totals"."entry_count" > $14 returning *)',
    );
    expect(sql).toContain(
      '"lines" as (insert into "billing_snapshot_entries" ("slack_team_id", "snapshot_id", "time_entry_id", "minutes", "billable", "hourly_rate", "amount") ' +
        'select "picked"."slack_team_id", "snapshot"."id", "picked"."time_entry_id", "picked"."minutes", "picked"."billable", "picked"."hourly_rate", "picked"."amount" ' +
        'from "picked" cross join "snapshot")',
    );
    expect(sql).toMatch(
      /select "snapshot"\.\*, .*"totals"\."entry_count", "totals"\."unrated_minutes" from "snapshot" cross join "totals"$/,
    );
    expect(parametersOf(0)).toEqual([
      'team-1',
      'team-1',
      'acme',
      'approved',
      '2026-10-01',
      '2026-10-31',
      'team-1',
      'acme',
      '2026-10-01',
      '2026-10-31',
      'EUR',
      expect.any(String),
      'actor',
      0,
    ]);
  });

  it('makes nothing when nothing is left to take', async () => {
    const { database } = recordingDatabase([[]]);

    expect(
      await new BillingSnapshotsRepository(database).createFromUnbilled(
        NEW_SNAPSHOT,
      ),
    ).toBeNull();
  });

  it('refuses a snapshot without a workspace', async () => {
    const { database, queries } = recordingDatabase();

    await expect(
      new BillingSnapshotsRepository(database).createFromUnbilled({
        ...NEW_SNAPSHOT,
        slackTeamId: '',
      }),
    ).rejects.toThrow('a query without a workspace ID');
    expect(queries).toHaveLength(0);
  });
});
