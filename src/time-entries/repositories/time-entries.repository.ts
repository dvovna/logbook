import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { Injectable } from '@nestjs/common';
import { ExpressionBuilder, RawBuilder, sql } from 'kysely';
import UserRole from '@common/enums/user-role.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';
import {
  IRelation,
  BaseRepository,
} from '@common/repositories/base.repository';
import {
  SqlDatabase,
  SqlRow,
  SqlUpdate,
} from '@common/types/sql-database.types';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { ITimeEntryListItem } from 'src/time-entries/types/time-entries-list.types';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { OPEN_TIME_ENTRY_STATUSES } from 'src/time-entries/constants/open-time-entry-statuses';
import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import {
  IReportEntriesQuery,
  ITimeReportCsvRow,
  ITimeReportGroupSum,
  IUserTimeSum,
  TimeReportCsvCursor,
} from 'src/time-entries/types/time-report.types';
import { onTimeOff } from '@modules/users/repositories/time-off-condition';

// Which approvers of an entry approves() names (all worked out for `today`):
// - 'listed': the team's active approving managers but the owner, else HR,
//   else the admins, whether at work or not;
// - 'inbox': the listed ones, and while none of them is at work also the
//   fallback approvers who are (HR at work, else admins at work);
// - 'told': who hears of submitted time: the listed ones at work, else the
//   fallback ones at work, else (nobody who could decide is at work) the
//   listed ones.
export type EntryApprovers = 'listed' | 'inbox' | 'told';

const dateOf = ({ work_date }: { work_date: string }) => work_date;

// ICU's root order, which String.localeCompare follows too: the CSV keeps the
// order it had when Node sorted it, whatever the database's own collation.
const NAME_COLLATION = 'und-x-icu';

// Each grouping's key and name, over the joins of sumReportGroups. No
// parameters: Postgres matches a grouped expression by its text.
const REPORT_GROUPS: Record<
  TimeReportGrouping,
  { key: RawBuilder<string | null>; name: RawBuilder<string | null> }
> = {
  // By the project's client rather than the entry's client_id, which entries
  // logged before it was filled in do not have.
  [TimeReportGrouping.Client]: {
    key: sql`(case when "p"."id" is not null then "pc"."id" else "ec"."id" end)::text`,
    name: sql`case when "p"."id" is not null then "pc"."name" else "ec"."name" end`,
  },
  [TimeReportGrouping.Project]: {
    key: sql`"c"."project_id"::text`,
    name: sql`"p"."name"`,
  },
  [TimeReportGrouping.Person]: {
    key: sql`"c"."user_id"::text`,
    name: sql`"u"."name"`,
  },
  [TimeReportGrouping.Team]: {
    key: sql`"tm"."id"::text`,
    name: sql`"tm"."name"`,
  },
};

@Injectable()
export class TimeEntriesRepository extends BaseRepository<
  'time_entries',
  ITimeEntryViewModel
> {
  protected readonly tableName = 'time_entries';

  protected relations: Record<string, IRelation> = {
    user: {
      table: 'users',
      foreignKey: 'user_id',
      columns: ['id', 'name', 'email', 'slack_id'],
    },
    team: { table: 'teams', foreignKey: 'team_id', columns: ['id', 'name'] },
    client: {
      table: 'clients',
      foreignKey: 'client_id',
      columns: ['id', 'name'],
    },
    project: {
      table: 'projects',
      foreignKey: 'project_id',
      columns: ['id', 'name'],
    },
  };

  protected mapToViewModel = (row: SqlRow<'time_entries'>) => {
    const extendedRow = row as SqlRow<'time_entries'> & {
      user?: { id: string; name: string; email: string; slack_id: string };
      team?: { id: string; name: string };
      client?: { id: string; name: string };
      project?: { id: string; name: string };
    };

    return {
      id: row.id,
      description: row.description || '',
      rejection_reason: row.rejection_reason ?? null,
      slack_team_id: row.slack_team_id,
      team_id: row.team_id,
      user_id: row.user_id,
      user: extendedRow.user
        ? {
            id: extendedRow.user.id,
            name: extendedRow.user.name,
            email: extendedRow.user.email,
            slack_id: extendedRow.user.slack_id,
          }
        : null,
      client: extendedRow.client
        ? {
            id: extendedRow.client.id,
            name: extendedRow.client.name,
          }
        : null,
      project: extendedRow.project
        ? {
            id: extendedRow.project.id,
            name: extendedRow.project.name,
          }
        : null,
      team: extendedRow.team
        ? {
            id: extendedRow.team.id,
            name: extendedRow.team.name,
          }
        : null,
      client_id: row.client_id || null,
      work_date: row.work_date,
      minutes: row.minutes,
      billable: row.billable,
      status: row.status as TimeEntryStatus,
      project_id: row.project_id,
      vacation_request_id: row.vacation_request_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      created_by: row.created_by,
      updated_by: row.updated_by,
      deleted_at: row.deleted_at,
      deleted_by: row.deleted_by,
    };
  };

  // How many submitted entries wait for `approverId` (see approves()).
  public async countWaitingFor(
    slackTeamId: string,
    approverId: string,
    today: string,
  ): Promise<number> {
    const { count } = await this.db
      .selectFrom(
        this.waitingGroups(slackTeamId, approverId, today).as('waiting'),
      )
      .select(sql<number>`coalesce(sum("waiting"."entries"), 0)`.as('count'))
      .executeTakeFirstOrThrow();

    return Number(count);
  }

  // A page of the submitted entries that wait for `approverId` (see
  // approves()), as the lists show them, newest work first.
  public async findWaitingFor(
    slackTeamId: string,
    approverId: string,
    today: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<ITimeEntryListItem[]> {
    const rows = await this.waitingEntries(slackTeamId, approverId, today)
      .innerJoin('users', 'users.id', 'time_entries.user_id')
      .leftJoin('projects', 'projects.id', 'time_entries.project_id')
      .leftJoin('clients', 'clients.id', 'time_entries.client_id')
      .select([
        'time_entries.id',
        'time_entries.work_date',
        'time_entries.created_at',
        'users.name as user_name',
        'projects.name as project_name',
        'clients.name as client_name',
        'time_entries.minutes',
        'time_entries.description',
        'time_entries.rejection_reason',
        'time_entries.user_id',
        'time_entries.status',
      ])
      .orderBy('time_entries.work_date', 'desc')
      .orderBy('time_entries.created_at', 'desc')
      .orderBy('time_entries.id')
      .limit(limit)
      .offset(offset)
      .execute();

    return rows.map((row) => ({
      ...row,
      project_name: row.project_name ?? '',
      client_name: row.client_name ?? '',
      description: row.description ?? '',
      status: row.status as TimeEntryStatus,
    }));
  }

  // The IDs of all the submitted entries that wait for `approverId`.
  public async findWaitingIds(
    slackTeamId: string,
    approverId: string,
    today: string,
  ): Promise<string[]> {
    const rows = await this.waitingEntries(slackTeamId, approverId, today)
      .select('time_entries.id')
      .execute();

    return rows.map(({ id }) => id);
  }

  // Who each of the entries `ids` waits for (see approves()), as pairs.
  public async findApproverIds(
    slackTeamId: string,
    ids: string[],
    today: string,
    who: 'listed' | 'told',
  ): Promise<{ entry_id: string; approver_id: string }[]> {
    if (!ids.length) {
      return [];
    }

    return this.selectInWorkspace(slackTeamId)
      .innerJoin('users as approver', (join) =>
        join.on(
          this.approves(
            slackTeamId,
            {
              person: 'approver',
              team: 'time_entries.team_id',
              owner: 'time_entries.user_id',
            },
            { today, who },
          ),
        ),
      )
      .select(['time_entries.id as entry_id', 'approver.id as approver_id'])
      .where(sql<boolean>`"time_entries"."id" = any(${ids}::uuid[])`)
      .execute();
  }

  // The minutes of a period's entries, all and billable, deleted ones left
  // out: everyone's, or with `userId` that person's and those logged in
  // `teamIds`.
  public async sumMinutes(
    slackTeamId: string,
    {
      dateFrom,
      dateTo,
      userId,
      teamIds = [],
    }: {
      dateFrom: string;
      dateTo: string;
      userId?: string;
      teamIds?: string[];
    },
  ): Promise<{ minutes: number; billableMinutes: number }> {
    const row = await this.selectInWorkspace(slackTeamId)
      .select([
        sql<number>`coalesce(sum("minutes"), 0)`.as('minutes'),
        sql<number>`coalesce(sum("minutes") filter (where "billable"), 0)`.as(
          'billable_minutes',
        ),
      ])
      .where('deleted_at', 'is', null)
      .where('work_date', '>=', dateFrom)
      .where('work_date', '<=', dateTo)
      .$if(!!userId, (query) =>
        query.where((eb) =>
          eb.or([
            eb('user_id', '=', userId!),
            ...(teamIds.length ? [eb('team_id', 'in', teamIds)] : []),
          ]),
        ),
      )
      .executeTakeFirstOrThrow();

    return {
      minutes: Number(row.minutes),
      billableMinutes: Number(row.billable_minutes),
    };
  }

  // A time report's groups (see reportEntries), each with its time and, in
  // cents, the amount of its billable time: rounded per project and person
  // at their rate, then added up, as the billing report rounds. Reads the
  // entries in the database, and returns one row a group.
  public async sumReportGroups(
    slackTeamId: string,
    query: IReportEntriesQuery,
    groupBy: TimeReportGrouping,
  ): Promise<ITimeReportGroupSum[]> {
    // First by everything a group can be: few rows for the joins after it.
    const combos = this.reportEntries(slackTeamId, query)
      .select([
        'time_entries.project_id',
        'time_entries.user_id',
        'time_entries.team_id',
        'time_entries.client_id',
        sql<number>`count(*)`.as('entries'),
        sql<number>`sum("time_entries"."minutes")`.as('minutes'),
        sql<number>`coalesce(sum("time_entries"."minutes") filter (where "time_entries"."billable"), 0)`.as(
          'billable_minutes',
        ),
        sql<number>`coalesce(sum("time_entries"."minutes") filter (where "time_entries"."status" = ${TimeEntryStatus.Approved}), 0)`.as(
          'approved_minutes',
        ),
      ])
      .groupBy([
        'time_entries.project_id',
        'time_entries.user_id',
        'time_entries.team_id',
        'time_entries.client_id',
      ]);
    const { key, name } = REPORT_GROUPS[groupBy];
    const rate = sql<
      number | null
    >`case when "p"."id" is not null then coalesce("r"."hourly_rate", "p"."hourly_rate") end`;
    const byPersonOnProject = this.db
      .selectFrom(combos.as('c'))
      .leftJoin('projects as p', (join) =>
        join
          .onRef('p.id', '=', 'c.project_id')
          .on('p.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('clients as pc', (join) =>
        join
          .onRef('pc.id', '=', 'p.client_id')
          .on('pc.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('clients as ec', (join) =>
        join
          .onRef('ec.id', '=', 'c.client_id')
          .on('ec.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('users as u', (join) =>
        join
          .onRef('u.id', '=', 'c.user_id')
          .on('u.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('teams as tm', (join) =>
        join
          .onRef('tm.id', '=', 'c.team_id')
          .on('tm.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('project_user_rates as r', (join) =>
        join
          .onRef('r.project_id', '=', 'c.project_id')
          .onRef('r.user_id', '=', 'c.user_id')
          .on('r.slack_team_id', '=', slackTeamId),
      )
      .select([
        key.as('group_key'),
        sql<string | null>`min(${name})`.as('group_name'),
        sql<number | null>`min(${rate})`.as('hourly_rate'),
        sql<number>`sum("c"."entries")`.as('entries'),
        sql<number>`sum("c"."minutes")`.as('minutes'),
        sql<number>`sum("c"."billable_minutes")`.as('billable_minutes'),
        sql<number>`sum("c"."approved_minutes")`.as('approved_minutes'),
        sql<
          number | null
        >`round(min(${rate}) * 100 * sum("c"."billable_minutes") / 60)`.as(
          'amount',
        ),
      ])
      .groupBy([key, 'c.project_id', 'c.user_id']);
    const rows = await this.db
      .selectFrom(byPersonOnProject.as('g'))
      .select([
        'g.group_key',
        sql<string | null>`min("g"."group_name")`.as('group_name'),
        sql<number>`sum("g"."entries")`.as('entries'),
        sql<number>`sum("g"."minutes")`.as('minutes'),
        sql<number>`sum("g"."billable_minutes")`.as('billable_minutes'),
        sql<number>`sum("g"."approved_minutes")`.as('approved_minutes'),
        sql<number>`coalesce(sum("g"."amount"), 0)`.as('amount'),
        sql<number>`coalesce(sum("g"."billable_minutes") filter (where "g"."hourly_rate" is null), 0)`.as(
          'unrated_minutes',
        ),
      ])
      .groupBy('g.group_key')
      .execute();

    return rows.map((row) => ({
      key: row.group_key,
      name: row.group_name,
      entries: Number(row.entries),
      minutes: Number(row.minutes),
      billableMinutes: Number(row.billable_minutes),
      approvedMinutes: Number(row.approved_minutes),
      amount: Number(row.amount),
      unratedMinutes: Number(row.unrated_minutes),
    }));
  }

  // A page of a time report's entries (see reportEntries) as its CSV shows
  // them, in its order: by day, person, project and when they were logged,
  // names as the app sorts them (localeCompare, ICU's root order). `after`
  // is the last line of the page before.
  public async findReportCsvPage(
    slackTeamId: string,
    query: IReportEntriesQuery,
    {
      after,
      limit,
      withRates,
    }: { after?: TimeReportCsvCursor; limit: number; withRates: boolean },
  ): Promise<ITimeReportCsvRow[]> {
    const person = sql<string>`coalesce("u"."name", '')`;
    const project = sql<string>`coalesce("p"."name", '')`;
    const collated = (text: RawBuilder<string>) =>
      sql`${text} collate ${sql.id(NAME_COLLATION)}`;
    const sortKeys = [
      sql.ref('time_entries.work_date'),
      collated(person),
      collated(project),
      sql.ref('time_entries.created_at'),
      sql.ref('time_entries.id'),
    ];
    const rate = withRates
      ? sql<
          number | null
        >`case when "p"."id" is not null then coalesce("r"."hourly_rate", "p"."hourly_rate") end`
      : sql<null>`null`;
    const rows = await this.reportEntries(slackTeamId, query)
      .leftJoin('users as u', (join) =>
        join
          .onRef('u.id', '=', 'time_entries.user_id')
          .on('u.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('teams as tm', (join) =>
        join
          .onRef('tm.id', '=', 'time_entries.team_id')
          .on('tm.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('projects as p', (join) =>
        join
          .onRef('p.id', '=', 'time_entries.project_id')
          .on('p.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('clients as pc', (join) =>
        join
          .onRef('pc.id', '=', 'p.client_id')
          .on('pc.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('clients as ec', (join) =>
        join
          .onRef('ec.id', '=', 'time_entries.client_id')
          .on('ec.slack_team_id', '=', slackTeamId),
      )
      .leftJoin('project_user_rates as r', (join) =>
        join
          .onRef('r.project_id', '=', 'time_entries.project_id')
          .onRef('r.user_id', '=', 'time_entries.user_id')
          .on('r.slack_team_id', '=', slackTeamId),
      )
      .select([
        'time_entries.id',
        'time_entries.work_date',
        'time_entries.created_at',
        person.as('person'),
        'u.email',
        'tm.name as team',
        sql<
          string | null
        >`case when "p"."id" is not null then "pc"."name" else "ec"."name" end`.as(
          'client',
        ),
        project.as('project'),
        'time_entries.description',
        'time_entries.minutes',
        'time_entries.billable',
        'time_entries.status',
        rate.as('hourly_rate'),
      ])
      .$if(!!after, (page) =>
        page
          // Implied by the next condition, but the index on the day can
          // start there.
          .where('time_entries.work_date', '>=', after!.work_date)
          .where(
            sql<boolean>`(${sql.join(sortKeys)}) > (${sql.join([
              sql`${after!.work_date}::date`,
              sql`${after!.person}`,
              sql`${after!.project}`,
              sql`${after!.created_at}::timestamptz`,
              sql`${after!.id}::uuid`,
            ])})`,
          ),
      )
      .$call((page) =>
        sortKeys.reduce((sorted, key) => sorted.orderBy(key), page),
      )
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      ...row,
      status: row.status as TimeEntryStatus,
      hourly_rate: row.hourly_rate === null ? null : Number(row.hourly_rate),
    }));
  }

  // Each person's minutes of a period, all and of drafts and rejected
  // entries, with how many of those; deleted entries left out. A row for
  // each of `userIds` who logged any.
  public async sumOfUsers(
    slackTeamId: string,
    userIds: string[],
    { dateFrom, dateTo }: { dateFrom: string; dateTo: string },
  ): Promise<IUserTimeSum[]> {
    if (!userIds.length) {
      return [];
    }

    const open = sql`"status" in (${sql.join(OPEN_TIME_ENTRY_STATUSES)})`;
    const rows = await this.selectInWorkspace(slackTeamId)
      .select([
        'user_id',
        sql<number>`sum("minutes")`.as('minutes'),
        sql<number>`coalesce(sum("minutes") filter (where ${open}), 0)`.as(
          'open_minutes',
        ),
        sql<number>`count(*) filter (where ${open})`.as('open_count'),
      ])
      .where(sql<boolean>`"user_id" = any(${userIds}::uuid[])`)
      .where('deleted_at', 'is', null)
      .where('work_date', '>=', dateFrom)
      .where('work_date', '<=', dateTo)
      .groupBy('user_id')
      .execute();

    return rows.map((row) => ({
      userId: row.user_id,
      minutes: Number(row.minutes),
      openMinutes: Number(row.open_minutes),
      openCount: Number(row.open_count),
    }));
  }

  // A person's minutes of a period, and how many drafts and rejected entries
  // of any date they have and their minutes; deleted entries left out.
  public async sumOfUser(
    slackTeamId: string,
    userId: string,
    { dateFrom, dateTo }: { dateFrom: string; dateTo: string },
  ): Promise<{ minutes: number; openCount: number; openMinutes: number }> {
    const inPeriod = sql`"work_date" between ${dateFrom} and ${dateTo}`;
    const open = sql`"status" in (${sql.join(OPEN_TIME_ENTRY_STATUSES)})`;
    const row = await this.selectInWorkspace(slackTeamId)
      .select([
        sql<number>`coalesce(sum("minutes") filter (where ${inPeriod}), 0)`.as(
          'minutes',
        ),
        sql<number>`count(*) filter (where ${open})`.as('open_count'),
        sql<number>`coalesce(sum("minutes") filter (where ${open}), 0)`.as(
          'open_minutes',
        ),
      ])
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`(${inPeriod} or ${open})`)
      .executeTakeFirstOrThrow();

    return {
      minutes: Number(row.minutes),
      openCount: Number(row.open_count),
      openMinutes: Number(row.open_minutes),
    };
  }

  // A person's minutes of one day per client name, most first, then the
  // client of the latest entry; entries without a client under null.
  public async sumOfUserByClient(
    slackTeamId: string,
    userId: string,
    date: string,
  ): Promise<{ client_name: string | null; minutes: number }[]> {
    const minutes = sql<number>`sum("time_entries"."minutes")`;
    const rows = await this.selectInWorkspace(slackTeamId)
      .leftJoin('clients', 'clients.id', 'time_entries.client_id')
      .select(['clients.name as client_name', minutes.as('minutes')])
      .where('time_entries.user_id', '=', userId)
      .where('time_entries.deleted_at', 'is', null)
      .where('time_entries.work_date', '=', date)
      .groupBy('clients.name')
      .orderBy(minutes, 'desc')
      .orderBy(sql`max("time_entries"."created_at")`, 'desc')
      .execute();

    return rows.map(({ client_name, minutes }) => ({
      client_name,
      minutes: Number(minutes),
    }));
  }

  // Not deleted, cancelled ones included; without the relations, in
  // findMany's order.
  public async findOfUserWithBilled(
    slackTeamId: string,
    {
      userId,
      dateFrom,
      dateTo,
    }: { userId: string; dateFrom: string; dateTo: string },
  ): Promise<{ entries: ITimeEntryViewModel[]; billedIds: Set<string> }> {
    const rows = await this.selectInWorkspace(slackTeamId)
      .selectAll()
      .select((eb) =>
        eb
          .exists(
            eb
              .selectFrom('billing_snapshot_entries')
              .select('billing_snapshot_entries.time_entry_id')
              .where('billing_snapshot_entries.slack_team_id', '=', slackTeamId)
              .whereRef(
                'billing_snapshot_entries.time_entry_id',
                '=',
                'time_entries.id',
              ),
          )
          .as('billed'),
      )
      .where('user_id', '=', userId)
      .where('deleted_at', 'is', null)
      .where('work_date', '>=', dateFrom)
      .where('work_date', '<=', dateTo)
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .execute();

    return {
      entries: rows.map((row) => this.toViewModel(row)),
      billedIds: new Set(rows.filter((row) => row.billed).map(({ id }) => id)),
    };
  }

  // With the day of the oldest one, null when none.
  public async countOpenUpTo(
    slackTeamId: string,
    userId: string,
    dateTo: string,
  ): Promise<{ count: number; oldest: string | null }> {
    const { count, oldest } = await this.selectInWorkspace(slackTeamId)
      .select((eb) => [
        eb.fn.countAll<string>().as('count'),
        eb.fn.min('work_date').as('oldest'),
      ])
      .where('user_id', '=', userId)
      .where('status', 'in', OPEN_TIME_ENTRY_STATUSES)
      .where('deleted_at', 'is', null)
      .where('work_date', '<=', dateTo)
      .executeTakeFirstOrThrow();

    return { count: Number(count), oldest };
  }

  // Who has drafts or rejected entries up to `dateTo`, each once, without
  // loading the entries.
  public async findUserIdsWithOpenUpTo(
    slackTeamId: string,
    dateTo: string,
    reminders: TimeReminder[],
  ): Promise<string[]> {
    if (!reminders.length) {
      return [];
    }

    const rows = await this.selectInWorkspace(slackTeamId)
      .select('user_id')
      .distinct()
      .where('status', 'in', OPEN_TIME_ENTRY_STATUSES)
      .where('deleted_at', 'is', null)
      .where('work_date', '<=', dateTo)
      .where('user_id', 'in', (eb) =>
        eb
          .selectFrom('users')
          .select('users.id')
          .where('users.slack_team_id', '=', slackTeamId)
          .where('users.is_active', '=', true)
          .where('users.time_reminder', 'in', reminders),
      )
      .execute();

    return rows.map(({ user_id }) => user_id);
  }

  // Gives each entry of `minutesById` its minutes, and all of them
  // `changes`, in one statement, but only those still not deleted and, with
  // `statuses`, in one of them. Returns the IDs it changed.
  public async setMinutes(
    slackTeamId: string,
    minutesById: Map<string, number>,
    changes: SqlUpdate<'time_entries'>,
    statuses?: TimeEntryStatus[],
  ): Promise<string[]> {
    if (!minutesById.size) {
      return [];
    }

    const minutes = sql<number>`case ${sql.join(
      [...minutesById].map(
        ([id, value]) => sql`when id = ${id} then ${value}::integer`,
      ),
      sql` `,
    )} end`;
    const rows = await this.updateInWorkspace(slackTeamId)
      .set({ ...changes, minutes })
      .where('id', 'in', [...minutesById.keys()])
      .where('deleted_at', 'is', null)
      .$if(!!statuses, (query) => query.where('status', 'in', statuses!))
      .returning('id')
      .execute();

    return rows.map(({ id }) => id);
  }

  // Deletes the entries logged from a vacation (keeping them as history) but
  // those a billing snapshot holds, in one statement. Returns what it
  // deleted, and the days of the kept ones.
  public async deleteVacationTime(
    slackTeamId: string,
    vacationRequestId: string,
    deletedBy: string,
  ): Promise<{
    deleted: {
      work_date: string;
      minutes: number;
      project_id: string;
      user_id: string;
    }[];
    billedDates: string[];
  }> {
    const ofVacation = this.selectInWorkspace(slackTeamId)
      .where('vacation_request_id', '=', vacationRequestId)
      .where('deleted_at', 'is', null);
    const billed = (eb: ExpressionBuilder<SqlDatabase, 'time_entries'>) =>
      eb.exists(
        eb
          .selectFrom('billing_snapshot_entries')
          .select('billing_snapshot_entries.time_entry_id')
          .where('billing_snapshot_entries.slack_team_id', '=', slackTeamId)
          .whereRef(
            'billing_snapshot_entries.time_entry_id',
            '=',
            'time_entries.id',
          ),
      );
    const rows = await this.db
      .with('deleted', (db) =>
        db
          .updateTable('time_entries')
          .set({ deleted_at: new Date().toISOString(), deleted_by: deletedBy })
          .where('slack_team_id', '=', slackTeamId)
          .where('vacation_request_id', '=', vacationRequestId)
          .where('deleted_at', 'is', null)
          .where((eb) => eb.not(billed(eb)))
          .returning(['work_date', 'minutes', 'project_id', 'user_id']),
      )
      .selectFrom('deleted')
      .select([
        sql<boolean>`false`.as('billed'),
        'work_date',
        'minutes',
        'project_id',
        'user_id',
      ])
      .unionAll(
        ofVacation
          .where(billed)
          .select([
            sql<boolean>`true`.as('billed'),
            'work_date',
            'minutes',
            'project_id',
            'user_id',
          ]),
      )
      .execute();

    return {
      deleted: rows
        .filter((row) => !row.billed)
        .map(({ work_date, minutes, project_id, user_id }) => ({
          work_date,
          minutes,
          project_id,
          user_id,
        })),
      billedDates: rows.filter((row) => row.billed).map(dateOf),
    };
  }

  // Which of the entries are in a billing snapshot, and so can't change
  // until an admin unlocks it. The IDs go as one array parameter: the billing
  // report passes every approved entry of a period, and a statement takes at
  // most 65535 parameters.
  public async findBilledIds(
    slackTeamId: string,
    ids: string[],
  ): Promise<Set<string>> {
    if (!slackTeamId) {
      throw new Error('[time_entries] findBilledIds without a workspace ID');
    }

    if (!ids.length) {
      return new Set();
    }

    const rows = await this.db
      .selectFrom('billing_snapshot_entries')
      .select('time_entry_id')
      .where('slack_team_id', '=', slackTeamId)
      .where(sql<boolean>`time_entry_id = any(${ids}::uuid[])`)
      .execute();

    return new Set(rows.map(({ time_entry_id }) => time_entry_id));
  }

  // The entries of a time report: a period's, deleted ones left out, within
  // the scope (with its `userId`, that person's and those logged in its
  // `teamIds`), then narrowed by the filters: a client's projects (archived
  // ones too), a project, a person.
  private reportEntries(
    slackTeamId: string,
    { dateFrom, dateTo, scope, filters }: IReportEntriesQuery,
  ) {
    const teamIds = scope.teamIds ?? [];

    return this.selectInWorkspace(slackTeamId)
      .where('time_entries.deleted_at', 'is', null)
      .where('time_entries.work_date', '>=', dateFrom)
      .where('time_entries.work_date', '<=', dateTo)
      .$if(!!scope.userId, (query) =>
        query.where((eb) =>
          eb.or([
            eb('time_entries.user_id', '=', scope.userId!),
            ...(teamIds.length
              ? [eb('time_entries.team_id', 'in', teamIds)]
              : []),
          ]),
        ),
      )
      .$if(!!filters.clientId, (query) =>
        query.where('time_entries.project_id', 'in', (eb) =>
          eb
            .selectFrom('projects')
            .select('projects.id')
            .where('projects.slack_team_id', '=', slackTeamId)
            .where('projects.client_id', '=', filters.clientId!),
        ),
      )
      .$if(!!filters.projectId, (query) =>
        query.where('time_entries.project_id', '=', filters.projectId!),
      )
      .$if(!!filters.userId, (query) =>
        query.where('time_entries.user_id', '=', filters.userId!),
      );
  }

  // The submitted entries that wait for `approverId`.
  private waitingEntries(
    slackTeamId: string,
    approverId: string,
    today: string,
  ) {
    return this.selectInWorkspace(slackTeamId)
      .innerJoin(
        this.waitingGroups(slackTeamId, approverId, today).as('waiting'),
        (join) =>
          join
            .onRef('waiting.user_id', '=', 'time_entries.user_id')
            .on(
              sql<boolean>`"waiting"."team_id" is not distinct from "time_entries"."team_id"`,
            ),
      )
      .where('time_entries.status', '=', TimeEntryStatus.Submitted)
      .where('time_entries.deleted_at', 'is', null);
  }

  // The submitted entries of others by team and owner, with how many each,
  // where they wait for `approverId`. Whom an entry waits for depends on its
  // team and owner only, so the rule runs once a pair, not once an entry:
  // Admin and HR would otherwise run it for every submitted entry of the
  // workspace.
  private waitingGroups(
    slackTeamId: string,
    approverId: string,
    today: string,
  ) {
    return this.selectInWorkspace(slackTeamId)
      .select([
        'time_entries.team_id',
        'time_entries.user_id',
        (eb) => eb.fn.countAll<number>().as('entries'),
      ])
      .where('time_entries.status', '=', TimeEntryStatus.Submitted)
      .where('time_entries.deleted_at', 'is', null)
      .where('time_entries.user_id', '!=', approverId)
      .groupBy(['time_entries.team_id', 'time_entries.user_id'])
      .having((eb) =>
        eb.exists(
          eb
            .selectFrom('users as approver')
            .select('approver.id')
            .where('approver.id', '=', approverId)
            .where(
              this.approves(
                slackTeamId,
                {
                  person: 'approver',
                  team: 'time_entries.team_id',
                  owner: 'time_entries.user_id',
                },
                { today, who: 'inbox' },
              ),
            ),
        ),
      );
  }

  // Whether `person` (a row of users) is among the approvers `who` of the
  // submitted entries of `owner` logged in `team` (columns of the query
  // around it). The listed ones are the active people with a role that
  // approves (MANAGER_ROLES) whom the team lists among its manager
  // approvers, but the owner; when there are none, everyone with the HR
  // role, else every admin, never the owner (as fallbackApprovers does for
  // time off). Who is away is approved time off covering `today`
  // (onTimeOff). Admin and HR may decide any entry; this is the one rule
  // for what waits for whom: the Approvals count, the inbox, Approve all
  // and the messages on submission.
  private approves(
    slackTeamId: string,
    refs: { person: string; team: string; owner: string },
    { today, who }: { today: string; who: EntryApprovers },
  ): RawBuilder<boolean> {
    const column = (alias: string, name: string) => sql.ref(`${alias}.${name}`);
    const team = sql.ref(refs.team);
    const approving = (alias: string) =>
      sql`${column(alias, 'slack_team_id')} = ${slackTeamId}
        and ${column(alias, 'is_active')}
        and ${column(alias, 'role')} in (${sql.join(MANAGER_ROLES)})
        and ${column(alias, 'id')} <> ${sql.ref(refs.owner)}`;
    const atWork = (alias: string) =>
      sql`not ${onTimeOff(`${alias}.id`, slackTeamId, today)}`;
    const listed = (alias: string) => sql<boolean>`(${approving(alias)} and case
      when exists (
        select 1 from "teams" as "listing"
        join "users" as "manager"
          on "manager"."slack_id" = any("listing"."manager_approvers")
        where "listing"."id" = ${team}
          and "listing"."slack_team_id" = ${slackTeamId}
          and ${approving('manager')}
      ) then exists (
        select 1 from "teams" as "listing"
        where "listing"."id" = ${team}
          and "listing"."slack_team_id" = ${slackTeamId}
          and ${column(alias, 'slack_id')} = any("listing"."manager_approvers")
      )
      when exists (
        select 1 from "users" as "hr"
        where ${approving('hr')} and "hr"."role" = ${UserRole.HR}
      ) then ${column(alias, 'role')} = ${UserRole.HR}
      else ${column(alias, 'role')} = ${UserRole.Admin}
    end)`;
    const person = refs.person;

    if (who === 'listed') {
      return listed(person);
    }

    const someListedAtWork = sql`exists (
      select 1 from "users" as "listed_at_work"
      where ${listed('listed_at_work')} and ${atWork('listed_at_work')}
    )`;
    const fallbackAtWork = (alias: string) =>
      sql`(${approving(alias)} and ${atWork(alias)} and case
        when exists (
          select 1 from "users" as "hr_at_work"
          where ${approving('hr_at_work')}
            and "hr_at_work"."role" = ${UserRole.HR}
            and ${atWork('hr_at_work')}
        ) then ${column(alias, 'role')} = ${UserRole.HR}
        else ${column(alias, 'role')} = ${UserRole.Admin}
      end)`;

    if (who === 'inbox') {
      // The away managers keep the entry in theirs.
      return sql<boolean>`(${listed(person)}
        or (not ${someListedAtWork} and ${fallbackAtWork(person)}))`;
    }

    const someFallbackAtWork = sql`exists (
      select 1 from "users" as "fallback_at_work"
      where ${approving('fallback_at_work')}
        and "fallback_at_work"."role" in (${UserRole.HR}, ${UserRole.Admin})
        and ${atWork('fallback_at_work')}
    )`;

    return sql<boolean>`(case
      when ${someListedAtWork} then (${listed(person)} and ${atWork(person)})
      when ${someFallbackAtWork} then ${fallbackAtWork(person)}
      else ${listed(person)}
    end)`;
  }
}
