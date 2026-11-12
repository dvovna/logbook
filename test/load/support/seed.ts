import { sql } from 'kysely';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import {
  TestDatabase,
  TestWorkspace,
} from 'test/integration/support/test-workspace';

// A company the size the load review (dvovna/logbook#80) worried about:
// 400 people in 20 teams of a manager and about 19 people, with an admin,
// HR and Finance in no team, and a year of 1 or 2 entries a working day each.
export const PEOPLE = 400;
export const TEAMS = 20;
const CLIENTS = 10;

// The year of time: Monday 2025-06-16 to last Friday. The test runs on
// Monday 2026-06-15, the reminder's morning.
const FIRST_DAY = '2025-06-16';
export const LAST_WEEK = '2026-06-08';
const LAST_DAY = '2026-06-12';

// Person `n` (1…PEOPLE): 1 is the admin, 2…4 HR, 5 and 6 Finance, 7…26 the
// managers of teams 1…20, and the rest members, spread over the teams.
const NO_TEAM = 6;
const ROLE_OF = `case
    when n = 1 then '${UserRole.Admin}'
    when n <= 4 then '${UserRole.HR}'
    when n <= ${NO_TEAM} then '${UserRole.Finance}'
    when n <= ${NO_TEAM + TEAMS} then '${UserRole.Manager}'
    else '${UserRole.Member}'
  end`;
const TEAM_OF = `case
    when n <= ${NO_TEAM} then null
    when n <= ${NO_TEAM + TEAMS} then n - ${NO_TEAM}
    else (n - ${NO_TEAM + TEAMS + 1}) % ${TEAMS} + 1
  end`;
// Last week's time of person `n`: 6 in 10 left it in drafts (the reminder
// goes to them), 3 in 10 submitted it (it waits in their manager's
// Approvals), 1 in 10 had it approved already.
const lastWeekStatus = (n: string) => `case
    when ${n} % 10 < 6 then 'draft'
    when ${n} % 10 < 9 then 'submitted'
    else 'approved'
  end`;

export const slackIdOf = (n: number) => `UL${String(n).padStart(5, '0')}`;
const teamName = (k: number | string) =>
  `'Team ' || lpad((${k})::text, 2, '0')`;

export interface ILoadCompany {
  workspace: TestWorkspace;
  admin: Tables<'users'>;
  hr: Tables<'users'>[];
  finance: Tables<'users'>[];
  managers: Tables<'users'>[];
  // Members whose last week is still in drafts.
  withDrafts: Tables<'users'>[];
  members: Tables<'users'>[];
  entries: number;
}

// Seeds the company in one transaction: each table in one statement
// (`insert … select generate_series`), whatever its size. The statement
// timeout of the app's connections (10 s) is lifted for it.
export const seedCompany = async (
  db: TestDatabase,
  workspace: TestWorkspace,
): Promise<ILoadCompany> => {
  const ws = workspace.id;

  const users = await db.transaction().execute(async (trx) => {
    await sql`set local statement_timeout = 0`.execute(trx);

    const { rows: policies } = await sql<{ id: string }>`
      insert into vacation_policies (slack_team_id, name, vacation_days, carryover_days)
      values (${ws}, 'Standard', 25, 5)
      returning id
    `.execute(trx);
    const policyId = policies[0].id;

    await sql`
      insert into rule_sets (slack_team_id, is_default)
      values (${ws}, true)
      on conflict do nothing
    `.execute(trx);
    const { rows: ruleSets } = await sql<{ id: string }>`
      update rule_sets
      set hr_approvers = ${[2, 3, 4].map(slackIdOf)}::text[],
        vacation_policy_id = ${policyId}
      where slack_team_id = ${ws} and is_default
      returning id
    `.execute(trx);

    await sql`
      insert into teams (slack_team_id, name, manager_approvers, rule_set_id, vacation_policy_id)
      select ${ws}, ${sql.raw(teamName('k'))},
        array['UL' || lpad((${NO_TEAM} + k)::text, 5, '0')], ${ruleSets[0].id}, ${policyId}
      from generate_series(1, ${TEAMS}) k
    `.execute(trx);

    const { rows: people } = await sql<Tables<'users'>>`
      insert into users (slack_team_id, slack_id, name, email, role, team_id, created_at)
      select ${ws}, 'UL' || lpad(n::text, 5, '0'),
        'Person ' || lpad(n::text, 3, '0'), 'person' || n || '@load.test',
        ${sql.raw(ROLE_OF)}, team.id, '2024-01-01'
      from generate_series(1, ${PEOPLE}) n
      left join teams team on team.slack_team_id = ${ws}
        and team.name = ${sql.raw(teamName(TEAM_OF))}
      order by n
      returning *
    `.execute(trx);

    await sql`
      insert into clients (slack_team_id, name)
      select ${ws}, 'Client ' || lpad(c::text, 2, '0')
      from generate_series(1, ${CLIENTS}) c
    `.execute(trx);

    // Two projects of each team's own, at a rate, and two that every team
    // shares: Support, billable, and Internal, not.
    await sql`
      insert into projects (slack_team_id, client_id, name, hourly_rate, billable)
      select ${ws}::uuid, client.id, 'Project ' || lpad(p::text, 2, '0'),
        80 + p % 5 * 10, true
      from generate_series(1, ${2 * TEAMS}) p
      join clients client on client.slack_team_id = ${ws}
        and client.name = 'Client ' || lpad(((p - 1) / 2 % ${CLIENTS} + 1)::text, 2, '0')
      union all
      select ${ws}::uuid, client.id, 'Support', 60, true
      from clients client
      where client.slack_team_id = ${ws} and client.name = 'Client 01'
      union all
      select ${ws}::uuid, null, 'Internal', null, false
    `.execute(trx);

    await sql`
      insert into project_teams (slack_team_id, team_id, project_id)
      select ${ws}, team.id, project.id
      from teams team
      join projects project on project.slack_team_id = team.slack_team_id
        and project.name in ('Support', 'Internal',
          'Project ' || lpad((2 * right(team.name, 2)::int - 1)::text, 2, '0'),
          'Project ' || lpad((2 * right(team.name, 2)::int)::text, 2, '0'))
      where team.slack_team_id = ${ws}
    `.execute(trx);

    await sql`
      insert into project_users (slack_team_id, project_id, user_id)
      select ${ws}, project.id, person.id
      from users person
      join projects project on project.slack_team_id = person.slack_team_id
        and project.name = 'Internal'
      where person.slack_team_id = ${ws} and person.team_id is null
    `.execute(trx);

    // Each working day: a person in a team works on one of the team's
    // projects (the other one every other week), and every other day also
    // on Support or Internal; the rest on Internal. Everything before last
    // week is approved.
    await sql`
      insert into time_entries (slack_team_id, user_id, team_id, project_id,
        client_id, work_date, minutes, billable, status, description,
        created_by, updated_by, created_at, updated_at)
      select ${ws}, person.id, person.team_id, project.id, project.client_id,
        day::date,
        case when slot = 2 then 180 when person.two then 300 else 480 end,
        project.billable,
        case when day < ${LAST_WEEK}::date then 'approved'
          else ${sql.raw(lastWeekStatus('person.n'))} end,
        'Work ' || to_char(day, 'IYYY-IW'),
        person.id, person.id, day, day
      from (
        select person.*, right(person.slack_id, 5)::int n,
          right(team.name, 2)::int team_no
        from users person
        left join teams team on team.id = person.team_id
        where person.slack_team_id = ${ws}
      ) person_row
      cross join generate_series(${FIRST_DAY}::date, ${LAST_DAY}::date, interval '1 day') day
      cross join lateral (
        select person_row.*, person_row.team_no is not null
          and (person_row.n + extract(doy from day)::int) % 2 = 0 two
      ) person
      cross join generate_series(1, 2) slot
      join projects project on project.slack_team_id = ${ws}
        and project.name = case
          when person.team_no is null then 'Internal'
          when slot = 1 then 'Project ' || lpad((2 * person.team_no - 1
            + extract(week from day)::int % 2)::text, 2, '0')
          when person.n % 2 = 0 then 'Support'
          else 'Internal'
        end
      where extract(isodow from day) < 6 and (slot = 1 or person.two)
    `.execute(trx);

    // Two weeks off in the year so far, and one person in ten off this
    // week: Home counts the balance from them on every read.
    await sql`
      insert into vacation_requests (slack_team_id, user_id, team_id,
        created_by, type, status, start_date, end_date, days, working_days,
        approved_by_manager, approved_by_hr)
      select ${ws}, person.id, person.team_id, person.id, 'annual_leave',
        'approved', start, start + 4, 5, 5, true, true
      from (
        select person.*, right(person.slack_id, 5)::int n
        from users person where person.slack_team_id = ${ws}
      ) person
      cross join lateral (values
        ('2025-08-04'::date + person.n % 8 * 7),
        ('2026-02-02'::date + person.n % 6 * 7),
        (case when person.n % 10 = 3 then '2026-06-15'::date end)
      ) vacation(start)
      where start is not null
    `.execute(trx);

    await sql`
      insert into holidays (slack_team_id, vacation_policy_id, name, date, year,
        is_company_custom, created_by)
      select ${ws}, ${policyId}, holiday.name, holiday.date::date,
        extract(year from holiday.date::date), true, admin.id
      from (values ('New Year', '2026-01-01'), ('Spring Day', '2026-05-01'),
        ('Summer Day', '2026-07-03'), ('Winter Day', '2025-12-25')) holiday(name, date)
      join users admin on admin.slack_team_id = ${ws}
        and admin.slack_id = ${slackIdOf(1)}
    `.execute(trx);

    return people;
  });

  // As autovacuum would soon after: the planner's statistics of the tables
  // that just grew.
  await sql`analyze time_entries, users, vacation_requests`.execute(db);

  const { rows } = await sql<{ count: string }>`
    select count(*) from time_entries where slack_team_id = ${ws}
  `.execute(db);
  const byRole = (role: UserRole) =>
    users
      .filter((user) => user.role === role)
      .sort((a, b) => a.slack_id.localeCompare(b.slack_id));
  const members = byRole(UserRole.Member);
  const numberOf = (user: Tables<'users'>) => Number(user.slack_id.slice(2));

  return {
    workspace,
    admin: byRole(UserRole.Admin)[0],
    hr: byRole(UserRole.HR),
    finance: byRole(UserRole.Finance),
    managers: byRole(UserRole.Manager),
    members,
    withDrafts: members.filter((member) => numberOf(member) % 10 < 6),
    entries: Number(rows[0].count),
  };
};

// Deletes the workspace and, through its foreign keys, all it holds: more
// than the 10 s a statement of the app's connections may take.
export const deleteCompany = async (
  db: TestDatabase,
  workspace: TestWorkspace,
) =>
  db.transaction().execute(async (trx) => {
    await sql`set local statement_timeout = 0`.execute(trx);
    await trx
      .deleteFrom('slack_teams')
      .where('id', '=', workspace.id)
      .execute();
  });
