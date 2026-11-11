import { recordingDatabase } from 'src/database/testing/recording-database';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';

describe('TimeEntriesRepository', () => {
  it("counts the user's open entries up to a day in one aggregate", async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ count: 2, oldest: '2026-06-03' }],
    ]);

    await expect(
      new TimeEntriesRepository(database).countOpenUpTo(
        'w1',
        'u1',
        '2026-06-14',
      ),
    ).resolves.toEqual({ count: 2, oldest: '2026-06-03' });
    expect(sqlOf(0)).toBe(
      'select count(*) as "count", min("work_date") as "oldest" from "time_entries" ' +
        'where "time_entries"."slack_team_id" = $1 and "user_id" = $2 and "status" in ($3, $4) ' +
        'and "deleted_at" is null and "work_date" <= $5',
    );
    expect(parametersOf(0)).toEqual([
      'w1',
      'u1',
      'draft',
      'rejected',
      '2026-06-14',
    ]);
  });

  it('finds who has open entries up to a day, each once, without the entries', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ user_id: 'u1' }, { user_id: 'u2' }],
    ]);

    await expect(
      new TimeEntriesRepository(database).findUserIdsWithOpenUpTo(
        'w1',
        '2026-06-14',
      ),
    ).resolves.toEqual(['u1', 'u2']);
    expect(sqlOf(0)).toBe(
      'select distinct "user_id" from "time_entries" ' +
        'where "time_entries"."slack_team_id" = $1 and "status" in ($2, $3) ' +
        'and "deleted_at" is null and "work_date" <= $4',
    );
    expect(parametersOf(0)).toEqual(['w1', 'draft', 'rejected', '2026-06-14']);
  });

  it('counts what waits for an approver in one row, running the rule once per team and owner', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ count: 12935 }],
    ]);

    await expect(
      new TimeEntriesRepository(database).countWaitingFor('w1', 'u1'),
    ).resolves.toBe(12935);
    expect(sqlOf(0)).toMatch(
      /^select coalesce\(sum\("waiting"\."entries"\), 0\) as "count" from \(select "time_entries"\."team_id", "time_entries"\."user_id", count\(\*\) as "entries" from "time_entries" where "time_entries"\."slack_team_id" = \$1 and "time_entries"\."status" = \$2 and "time_entries"\."deleted_at" is null and "time_entries"\."user_id" != \$3 group by "time_entries"\."team_id", "time_entries"\."user_id" having exists \(select "approver"\."id" from "users" as "approver" where "approver"\."id" = \$4 and /,
    );
    expect(parametersOf(0).slice(0, 4)).toEqual([
      'w1',
      'submitted',
      'u1',
      'u1',
    ]);
  });

  it("sums the minutes of a manager's teams and their own in one row", async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ minutes: 90, billable_minutes: 60 }],
    ]);

    await expect(
      new TimeEntriesRepository(database).sumMinutes('w1', {
        dateFrom: '2026-06-15',
        dateTo: '2026-06-21',
        userId: 'u1',
        teamIds: ['t1'],
      }),
    ).resolves.toEqual({ minutes: 90, billableMinutes: 60 });
    expect(sqlOf(0)).toBe(
      'select coalesce(sum("minutes"), 0) as "minutes", ' +
        'coalesce(sum("minutes") filter (where "billable"), 0) as "billable_minutes" ' +
        'from "time_entries" where "time_entries"."slack_team_id" = $1 ' +
        'and "deleted_at" is null and "work_date" >= $2 and "work_date" <= $3 ' +
        'and ("user_id" = $4 or "team_id" in ($5))',
    );
    expect(parametersOf(0)).toEqual([
      'w1',
      '2026-06-15',
      '2026-06-21',
      'u1',
      't1',
    ]);
  });

  it("sums a person's week and open entries in one row", async () => {
    const { database, sqlOf } = recordingDatabase([
      [{ minutes: 180, open_count: 2, open_minutes: 120 }],
    ]);

    await expect(
      new TimeEntriesRepository(database).sumOfUser('w1', 'u1', {
        dateFrom: '2026-06-15',
        dateTo: '2026-06-21',
      }),
    ).resolves.toEqual({ minutes: 180, openCount: 2, openMinutes: 120 });
    expect(sqlOf(0)).toBe(
      'select coalesce(sum("minutes") filter (where "work_date" between $1 and $2), 0) as "minutes", ' +
        'count(*) filter (where "status" in ($3, $4)) as "open_count", ' +
        'coalesce(sum("minutes") filter (where "status" in ($5, $6)), 0) as "open_minutes" ' +
        'from "time_entries" where "time_entries"."slack_team_id" = $7 and "user_id" = $8 ' +
        'and "deleted_at" is null and ("work_date" between $9 and $10 or "status" in ($11, $12))',
    );
  });

  it('sends the IDs to find billed entries as one parameter, however many', async () => {
    const ids = Array.from({ length: 70000 }, (_, index) => `e${index}`);
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ time_entry_id: 'e1' }],
    ]);

    await expect(
      new TimeEntriesRepository(database).findBilledIds('w1', ids),
    ).resolves.toEqual(new Set(['e1']));
    expect(sqlOf(0)).toBe(
      'select "time_entry_id" from "billing_snapshot_entries" ' +
        'where "slack_team_id" = $1 and time_entry_id = any($2::uuid[])',
    );
    expect(parametersOf(0)).toEqual(['w1', ids]);
  });

  it("keeps a vacation's billed entries by their own snapshot row", async () => {
    const { database, sqlOf } = recordingDatabase([[]]);

    await new TimeEntriesRepository(database).deleteVacationTime(
      'w1',
      'r1',
      'u1',
    );

    const billed = (parameter: string) =>
      'exists (select "billing_snapshot_entries"."time_entry_id" from "billing_snapshot_entries" ' +
      `where "billing_snapshot_entries"."slack_team_id" = ${parameter} ` +
      'and "billing_snapshot_entries"."time_entry_id" = "time_entries"."id")';

    expect(sqlOf(0)).toBe(
      'with "deleted" as (update "time_entries" set "deleted_at" = $1, "deleted_by" = $2 ' +
        'where "slack_team_id" = $3 and "vacation_request_id" = $4 and "deleted_at" is null ' +
        `and not ${billed('$5')} ` +
        'returning "work_date", "minutes", "project_id", "user_id") ' +
        'select false as "billed", "work_date", "minutes", "project_id", "user_id" from "deleted" ' +
        'union all select true as "billed", "work_date", "minutes", "project_id", "user_id" from "time_entries" ' +
        'where "time_entries"."slack_team_id" = $6 and "vacation_request_id" = $7 and "deleted_at" is null ' +
        `and ${billed('$8')}`,
    );
  });
});
