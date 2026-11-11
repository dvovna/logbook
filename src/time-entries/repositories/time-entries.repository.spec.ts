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
