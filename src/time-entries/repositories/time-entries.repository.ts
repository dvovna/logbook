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

const dateOf = ({ work_date }: { work_date: string }) => work_date;

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
  ): Promise<number> {
    const { count } = await this.db
      .selectFrom(this.waitingGroups(slackTeamId, approverId).as('waiting'))
      .select(sql<number>`coalesce(sum("waiting"."entries"), 0)`.as('count'))
      .executeTakeFirstOrThrow();

    return Number(count);
  }

  // A page of the submitted entries that wait for `approverId` (see
  // approves()), as the lists show them, newest work first.
  public async findWaitingFor(
    slackTeamId: string,
    approverId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<ITimeEntryListItem[]> {
    const rows = await this.waitingEntries(slackTeamId, approverId)
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
  ): Promise<string[]> {
    const rows = await this.waitingEntries(slackTeamId, approverId)
      .select('time_entries.id')
      .execute();

    return rows.map(({ id }) => id);
  }

  // Who each of the entries `ids` waits for (see approves()), as pairs.
  public async findApproverIds(
    slackTeamId: string,
    ids: string[],
  ): Promise<{ entry_id: string; approver_id: string }[]> {
    if (!ids.length) {
      return [];
    }

    return this.selectInWorkspace(slackTeamId)
      .innerJoin('users as approver', (join) =>
        join.on(
          this.approves(slackTeamId, {
            person: 'approver',
            team: 'time_entries.team_id',
            owner: 'time_entries.user_id',
          }),
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
  ): Promise<string[]> {
    const rows = await this.selectInWorkspace(slackTeamId)
      .select('user_id')
      .distinct()
      .where('status', 'in', OPEN_TIME_ENTRY_STATUSES)
      .where('deleted_at', 'is', null)
      .where('work_date', '<=', dateTo)
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

  // The submitted entries that wait for `approverId`.
  private waitingEntries(slackTeamId: string, approverId: string) {
    return this.selectInWorkspace(slackTeamId)
      .innerJoin(
        this.waitingGroups(slackTeamId, approverId).as('waiting'),
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
  private waitingGroups(slackTeamId: string, approverId: string) {
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
              this.approves(slackTeamId, {
                person: 'approver',
                team: 'time_entries.team_id',
                owner: 'time_entries.user_id',
              }),
            ),
        ),
      );
  }

  // Whether `person` (a row of users) is whom the submitted entries of
  // `owner` logged in `team` (columns of the query around it) wait for: the
  // active people with a role that approves (MANAGER_ROLES) whom the team
  // lists among its manager approvers, but the owner; when there are none,
  // everyone with the HR role, else every admin, never the owner (as
  // fallbackApprovers does for time off). Admin and HR may decide any entry;
  // this is the one rule for what waits for whom: the Approvals count, the
  // inbox, Approve all and the messages on submission.
  private approves(
    slackTeamId: string,
    refs: { person: string; team: string; owner: string },
  ): RawBuilder<boolean> {
    const column = (alias: string, name: string) => sql.ref(`${alias}.${name}`);
    const team = sql.ref(refs.team);
    const approving = (alias: string) =>
      sql`${column(alias, 'slack_team_id')} = ${slackTeamId}
        and ${column(alias, 'is_active')}
        and ${column(alias, 'role')} in (${sql.join(MANAGER_ROLES)})
        and ${column(alias, 'id')} <> ${sql.ref(refs.owner)}`;
    const role = column(refs.person, 'role');

    return sql<boolean>`(${approving(refs.person)} and case
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
          and ${column(refs.person, 'slack_id')} = any("listing"."manager_approvers")
      )
      when exists (
        select 1 from "users" as "hr"
        where ${approving('hr')} and "hr"."role" = ${UserRole.HR}
      ) then ${role} = ${UserRole.HR}
      else ${role} = ${UserRole.Admin}
    end)`;
  }
}
