import { randomUUID } from 'crypto';
import { Kysely, sql } from 'kysely';
import { Tables, TablesInsert } from '@common/types/database.types';
import { SqlDatabase, SqlTableName } from '@common/types/sql-database.types';
import UserRole from '@common/enums/user-role.enum';
import { ISlackWorkspace } from './slack-test-client';

// The app's own pool (DatabaseService), for fixtures and checks.
export type TestDatabase = Kysely<SqlDatabase>;

type WorkspaceTable = Exclude<SqlTableName, 'slack_teams'>;

// A Slack-like ID such as `U8F3A0C21DE`. Random, so tests never collide with
// each other or with data a developer keeps in the local database.
export const slackId = (prefix: 'T' | 'U' | 'C') =>
  `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

// One installed Slack workspace (a slack_teams row) per test. Every other row
// references it with ON DELETE CASCADE, so destroy() removes everything the
// test and the app created in it.
export class TestWorkspace implements ISlackWorkspace {
  private constructor(
    private readonly db: TestDatabase,
    public readonly id: string,
    public readonly slackId: string,
    public readonly token: string,
  ) {}

  public static async create(db: TestDatabase) {
    const teamSlackId = slackId('T');
    const token = `xoxb-test-${teamSlackId}`;

    const row = await db
      .insertInto('slack_teams')
      .values({
        slack_id: teamSlackId,
        name: `Integration ${teamSlackId}`,
        slack_token: token,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    return new TestWorkspace(db, row.id, teamSlackId, token);
  }

  public async addUser(
    fields: Partial<TablesInsert<'users'>> = {},
  ): Promise<Tables<'users'>> {
    const userSlackId = fields.slack_id ?? slackId('U');

    return this.db
      .insertInto('users')
      .values({
        slack_id: userSlackId,
        slack_team_id: this.id,
        name: `User ${userSlackId}`,
        email: `${userSlackId.toLowerCase()}@example.test`,
        role: UserRole.Member,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async addVacationPolicy(
    fields: Partial<TablesInsert<'vacation_policies'>> = {},
  ): Promise<Tables<'vacation_policies'>> {
    return this.db
      .insertInto('vacation_policies')
      .values({
        slack_team_id: this.id,
        name: `Policy ${randomUUID().slice(0, 8)}`,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // An approved annual leave of `user`, unless `fields` says otherwise.
  public async addVacationRequest(
    user: Tables<'users'>,
    fields: Partial<TablesInsert<'vacation_requests'>> &
      Pick<TablesInsert<'vacation_requests'>, 'start_date' | 'end_date'>,
  ): Promise<Tables<'vacation_requests'>> {
    return this.db
      .insertInto('vacation_requests')
      .values({
        slack_team_id: this.id,
        user_id: user.id,
        team_id: user.team_id,
        created_by: user.id,
        type: 'annual_leave',
        status: 'approved',
        days: 1,
        working_days: 1,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async addTeam(
    fields: Partial<TablesInsert<'teams'>> = {},
  ): Promise<Tables<'teams'>> {
    return this.db
      .insertInto('teams')
      .values({
        slack_team_id: this.id,
        name: `Team ${randomUUID().slice(0, 8)}`,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async addClient(
    fields: Partial<TablesInsert<'clients'>> = {},
  ): Promise<Tables<'clients'>> {
    return this.db
      .insertInto('clients')
      .values({
        slack_team_id: this.id,
        name: `Client ${randomUUID().slice(0, 8)}`,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  public async addProject(
    fields: Partial<TablesInsert<'projects'>> = {},
  ): Promise<Tables<'projects'>> {
    return this.db
      .insertInto('projects')
      .values({
        slack_team_id: this.id,
        name: `Project ${randomUUID().slice(0, 8)}`,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Lets the members of `teams` and the `users` log time on the project.
  public async assignToProject(
    project: Tables<'projects'>,
    {
      teams = [],
      users = [],
    }: {
      teams?: Tables<'teams'>[];
      users?: Tables<'users'>[];
    },
  ) {
    const link = { slack_team_id: this.id, project_id: project.id };

    if (teams.length) {
      await this.db
        .insertInto('project_teams')
        .values(teams.map((team) => ({ ...link, team_id: team.id })))
        .execute();
    }

    if (users.length) {
      await this.db
        .insertInto('project_users')
        .values(users.map((user) => ({ ...link, user_id: user.id })))
        .execute();
    }
  }

  // An hour of today's work by `user` on `project`, unless `fields` says otherwise.
  public async addTimeEntry(
    user: Tables<'users'>,
    project: Tables<'projects'>,
    fields: Partial<TablesInsert<'time_entries'>> = {},
  ): Promise<Tables<'time_entries'>> {
    return this.db
      .insertInto('time_entries')
      .values({
        slack_team_id: this.id,
        user_id: user.id,
        team_id: user.team_id,
        project_id: project.id,
        client_id: project.client_id,
        work_date: new Date().toISOString().slice(0, 10),
        minutes: 60,
        created_by: user.id,
        updated_by: user.id,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // Many entries in one insert, each an hour of today's work unless its
  // fields say otherwise.
  public async addTimeEntries(
    user: Tables<'users'>,
    project: Tables<'projects'>,
    entries: Partial<TablesInsert<'time_entries'>>[],
  ): Promise<void> {
    await this.db
      .insertInto('time_entries')
      .values(
        entries.map((fields) => ({
          slack_team_id: this.id,
          user_id: user.id,
          team_id: user.team_id,
          project_id: project.id,
          client_id: project.client_id,
          work_date: new Date().toISOString().slice(0, 10),
          minutes: 60,
          created_by: user.id,
          updated_by: user.id,
          ...fields,
        })),
      )
      .execute();
  }

  // Every row of `table` in this workspace, as the app reads it.
  public async rows<T extends WorkspaceTable>(table: T): Promise<Tables<T>[]> {
    const { rows } = await sql<Tables<T>>`
      select * from ${sql.table(table)} where slack_team_id = ${this.id}
    `.execute(this.db);

    return rows;
  }

  public async row<T extends WorkspaceTable>(
    table: T,
    id: string,
  ): Promise<Tables<T>> {
    const { rows } = await sql<Tables<T>>`
      select * from ${sql.table(table)}
      where slack_team_id = ${this.id} and id = ${id}
    `.execute(this.db);

    if (rows.length !== 1) {
      throw new Error(`${table} ${id}: ${rows.length} rows in the workspace`);
    }

    return rows[0];
  }

  public async destroy() {
    await this.db.deleteFrom('slack_teams').where('id', '=', this.id).execute();
  }
}
