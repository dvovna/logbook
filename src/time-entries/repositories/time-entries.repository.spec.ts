import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { recordingDatabase } from 'src/database/testing/recording-database';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';

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

  it('finds who has open entries up to a day and is reminded that often, each once, without the entries', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ user_id: 'u1' }, { user_id: 'u2' }],
    ]);

    await expect(
      new TimeEntriesRepository(database).findUserIdsWithOpenUpTo(
        'w1',
        '2026-06-14',
        [TimeReminder.Weekly, TimeReminder.Monthly],
      ),
    ).resolves.toEqual(['u1', 'u2']);
    expect(sqlOf(0)).toBe(
      'select distinct "user_id" from "time_entries" ' +
        'where "time_entries"."slack_team_id" = $1 and "status" in ($2, $3) ' +
        'and "deleted_at" is null and "work_date" <= $4 ' +
        'and "user_id" in (select "users"."id" from "users" ' +
        'where "users"."slack_team_id" = $5 and "users"."is_active" = $6 ' +
        'and "users"."time_reminder" in ($7, $8))',
    );
    expect(parametersOf(0)).toEqual([
      'w1',
      'draft',
      'rejected',
      '2026-06-14',
      'w1',
      true,
      'weekly',
      'monthly',
    ]);
  });

  it('asks nothing when nobody is reminded that often', async () => {
    const { database, sqlOf } = recordingDatabase([]);

    await expect(
      new TimeEntriesRepository(database).findUserIdsWithOpenUpTo(
        'w1',
        '2026-06-14',
        [],
      ),
    ).resolves.toEqual([]);
    expect(() => sqlOf(0)).toThrow();
  });

  it('counts what waits for an approver in one row, running the rule once per team and owner', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ count: 12935 }],
    ]);

    await expect(
      new TimeEntriesRepository(database).countWaitingFor(
        'w1',
        'u1',
        '2026-06-17',
      ),
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

  it('finds who is told of entries among the workspace’s approving people, today bound as a parameter', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([[]]);

    await new TimeEntriesRepository(database).findApproverIds(
      'w1',
      ['e1'],
      '2026-06-17',
    );

    // The approving conditions come first and alone, so Postgres scans
    // users by workspace and runs the rest only for its approving people.
    expect(sqlOf(0)).toMatch(
      /inner join "users" as "approver" on \("approver"\."slack_team_id" = \$1\s+and "approver"\."is_active"\s+and "approver"\."role" in \(\$2, \$3, \$4\)\s+and "approver"\."id" <> "time_entries"\."user_id" and case\s/,
    );
    expect(sqlOf(0)).not.toContain('2026-06-17');
    expect(parametersOf(0)[0]).toBe('w1');
    expect(parametersOf(0)).toContain('2026-06-17');
  });

  it.each(['told', 'listed'] as const)(
    'finds the approvers (%s) of the submitted entries once a team and owner',
    async (who) => {
      const { database, sqlOf, parametersOf } = recordingDatabase([
        [{ team_id: 't1', user_id: 'u1', entries: '3', approver_id: 'a1' }],
      ]);

      await expect(
        new TimeEntriesRepository(database).findSubmittedGroupApprovers(
          'w1',
          '2026-06-17',
          who,
        ),
      ).resolves.toEqual([
        { team_id: 't1', user_id: 'u1', entries: 3, approver_id: 'a1' },
      ]);

      expect(sqlOf(0)).toMatch(
        /from \(select "time_entries"\."team_id", "time_entries"\."user_id", count\(\*\) as "entries" from "time_entries" where "time_entries"\."slack_team_id" = \$1 and "time_entries"\."status" = \$2 and "time_entries"\."deleted_at" is null group by "time_entries"\."team_id", "time_entries"\."user_id"\) as "waiting" inner join "users" as "approver" on \("approver"\."slack_team_id" = \$3\s+and "approver"\."is_active"/,
      );
      expect(sqlOf(0)).not.toContain('2026-06-17');
      expect(parametersOf(0).slice(0, 3)).toEqual(['w1', 'submitted', 'w1']);
      expect(parametersOf(0).includes('2026-06-17')).toBe(who === 'told');
    },
  );

  it('sums what has waited for an approver since before a moment with the same rule, in one row', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [{ count: 14, people: 3, oldest: '2026-06-05T08:00:00.000000+00:00' }],
    ]);

    await expect(
      new TimeEntriesRepository(database).summarizeWaitingSince(
        'w1',
        'u1',
        new Date('2026-06-13T09:00:00Z'),
        '2026-06-17',
      ),
    ).resolves.toEqual({
      count: 14,
      people: 3,
      oldest: '2026-06-05T08:00:00.000000+00:00',
    });
    expect(sqlOf(0)).toMatch(
      /^select coalesce\(sum\("waiting"\."entries"\), 0\) as "count", count\(distinct "waiting"\."user_id"\) as "people", min\("waiting"\."oldest"\) as "oldest" from \(select "time_entries"\."team_id", "time_entries"\."user_id", count\(\*\) as "entries", min\("time_entries"\."updated_at"\) as "oldest" from "time_entries" where "time_entries"\."slack_team_id" = \$1 and "time_entries"\."status" = \$2 and "time_entries"\."deleted_at" is null and "time_entries"\."updated_at" < \$3 and "time_entries"\."user_id" != \$4 group by .* having exists /,
    );
    expect(parametersOf(0).slice(0, 4)).toEqual([
      'w1',
      'submitted',
      '2026-06-13T09:00:00.000Z',
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

  describe('time reports', () => {
    const PERIOD = { dateFrom: '2026-01-01', dateTo: '2026-12-31' };
    const scopedAndFiltered =
      'where "time_entries"."slack_team_id" = $2 and "time_entries"."deleted_at" is null ' +
      'and "time_entries"."work_date" >= $3 and "time_entries"."work_date" <= $4 ' +
      'and ("time_entries"."user_id" = $5 or "time_entries"."team_id" in ($6)) ' +
      'and "time_entries"."project_id" in (select "projects"."id" from "projects" ' +
      'where "projects"."slack_team_id" = $7 and "projects"."client_id" = $8) ' +
      'and "time_entries"."project_id" = $9 and "time_entries"."user_id" = $10 ';

    it('adds a report up in the database, one row a group, the filters after the scope', async () => {
      const { database, sqlOf, parametersOf } = recordingDatabase([
        [
          {
            group_key: 'p1',
            group_name: 'Website',
            entries: 3,
            minutes: 180,
            billable_minutes: 120,
            approved_minutes: 60,
            amount: '20000',
            unrated_minutes: 0,
          },
          {
            group_key: null,
            group_name: null,
            entries: 1,
            minutes: 15,
            billable_minutes: 15,
            approved_minutes: 0,
            amount: 0,
            unrated_minutes: 15,
          },
        ],
      ]);

      await expect(
        new TimeEntriesRepository(database).sumReportGroups(
          'w1',
          {
            ...PERIOD,
            scope: { userId: 'u1', teamIds: ['t1'] },
            filters: { clientId: 'c1', projectId: 'p1', userId: 'u2' },
          },
          TimeReportGrouping.Team,
        ),
      ).resolves.toEqual([
        {
          key: 'p1',
          name: 'Website',
          entries: 3,
          minutes: 180,
          billableMinutes: 120,
          approvedMinutes: 60,
          amount: 20000,
          unratedMinutes: 0,
        },
        {
          key: null,
          name: null,
          entries: 1,
          minutes: 15,
          billableMinutes: 15,
          approvedMinutes: 0,
          amount: 0,
          unratedMinutes: 15,
        },
      ]);
      // The entries by everything a group can be, then by group, project
      // and person (the amount rounds there), then by group.
      expect(sqlOf(0)).toContain(
        'from (select "time_entries"."project_id", "time_entries"."user_id", "time_entries"."team_id", "time_entries"."client_id", count(*) as "entries", ' +
          'sum("time_entries"."minutes") as "minutes", ' +
          'coalesce(sum("time_entries"."minutes") filter (where "time_entries"."billable"), 0) as "billable_minutes", ' +
          'coalesce(sum("time_entries"."minutes") filter (where "time_entries"."status" = $1), 0) as "approved_minutes" ' +
          `from "time_entries" ${scopedAndFiltered}` +
          'group by "time_entries"."project_id", "time_entries"."user_id", "time_entries"."team_id", "time_entries"."client_id") as "c" ',
      );
      expect(sqlOf(0)).toContain(
        'round(min(case when "p"."id" is not null then coalesce("r"."hourly_rate", "p"."hourly_rate") end) * 100 * sum("c"."billable_minutes") / 60) as "amount"',
      );
      expect(sqlOf(0)).toMatch(
        /group by "tm"\."id"::text, "c"\."project_id", "c"\."user_id"\) as "g" group by "g"\."group_key"$/,
      );
      expect(parametersOf(0).slice(0, 10)).toEqual([
        'approved',
        'w1',
        ...Object.values(PERIOD),
        'u1',
        't1',
        'w1',
        'c1',
        'p1',
        'u2',
      ]);
      expect(new Set(parametersOf(0).slice(10))).toEqual(new Set(['w1']));
    });

    it("reads a page of the CSV in its order, after the last page's last line", async () => {
      const { database, sqlOf, parametersOf } = recordingDatabase([
        [{ id: 'e1', status: 'draft', hourly_rate: '120.50' }],
      ]);
      const after = {
        work_date: '2026-03-02',
        person: 'Mia',
        project: 'Website',
        created_at: '2026-03-02T09:00:00.123456+00:00',
        id: 'e0',
      };

      await expect(
        new TimeEntriesRepository(database).findReportCsvPage(
          'w1',
          { ...PERIOD, scope: {}, filters: {} },
          { after, limit: 500, withRates: true },
        ),
      ).resolves.toEqual([{ id: 'e1', status: 'draft', hourly_rate: 120.5 }]);

      const keys =
        '"time_entries"."work_date", coalesce("u"."name", \'\') collate "und-x-icu", ' +
        'coalesce("p"."name", \'\') collate "und-x-icu", "time_entries"."created_at", "time_entries"."id"';

      expect(sqlOf(0)).toMatch(
        /^select "time_entries"\."id", "time_entries"\."work_date", "time_entries"\."created_at", coalesce\("u"\."name", ''\) as "person", /,
      );
      expect(sqlOf(0)).toContain(
        'where "time_entries"."slack_team_id" = $7 and "time_entries"."deleted_at" is null ' +
          'and "time_entries"."work_date" >= $8 and "time_entries"."work_date" <= $9 ' +
          'and "time_entries"."work_date" >= $10 ' +
          `and (${keys}) > ($11::date, $12, $13, $14::timestamptz, $15::uuid) ` +
          `order by ${keys} limit $16`,
      );
      expect(parametersOf(0).slice(9)).toEqual([
        after.work_date,
        ...Object.values(after),
        500,
      ]);
    });

    it('reads no rate for those who may not see rates', async () => {
      const { database, sqlOf } = recordingDatabase([[]]);

      await new TimeEntriesRepository(database).findReportCsvPage(
        'w1',
        { ...PERIOD, scope: { userId: 'u1', teamIds: [] }, filters: {} },
        { limit: 500, withRates: false },
      );

      expect(sqlOf(0)).toContain('null as "hourly_rate"');
      expect(sqlOf(0)).toContain('and "time_entries"."user_id" = $10 order by');
    });

    it("sums each person's time of a period in one row", async () => {
      const { database, sqlOf, parametersOf } = recordingDatabase([
        [{ user_id: 'u1', minutes: 90, open_minutes: 30, open_count: '1' }],
      ]);

      await expect(
        new TimeEntriesRepository(database).sumOfUsers(
          'w1',
          ['u1', 'u2'],
          PERIOD,
        ),
      ).resolves.toEqual([
        { userId: 'u1', minutes: 90, openMinutes: 30, openCount: 1 },
      ]);
      expect(sqlOf(0)).toBe(
        'select "user_id", sum("minutes") as "minutes", ' +
          'coalesce(sum("minutes") filter (where "status" in ($1, $2)), 0) as "open_minutes", ' +
          'count(*) filter (where "status" in ($3, $4)) as "open_count" from "time_entries" ' +
          'where "time_entries"."slack_team_id" = $5 and "user_id" = any($6::uuid[]) ' +
          'and "deleted_at" is null and "work_date" >= $7 and "work_date" <= $8 group by "user_id"',
      );
      expect(parametersOf(0).slice(4)).toEqual([
        'w1',
        ['u1', 'u2'],
        ...Object.values(PERIOD),
      ]);
    });
  });
});
