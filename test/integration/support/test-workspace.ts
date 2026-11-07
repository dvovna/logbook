import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Database, Tables, TablesInsert } from '@common/types/database.types';
import UserRole from '@common/enums/user-role.enum';
import { ISlackWorkspace } from './slack-test-client';

type TableName = keyof Database['public']['Tables'];

// A Slack-like ID such as `U8F3A0C21DE`. Random, so tests never collide with
// each other or with data a developer keeps in the local database.
export const slackId = (prefix: 'T' | 'U' | 'C') =>
  `${prefix}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;

const unwrap = <R extends { data: unknown; error: unknown }>({
  data,
  error,
}: R): NonNullable<R['data']> => {
  if (error || data === null || data === undefined) {
    throw new Error(`Supabase query failed: ${JSON.stringify(error)}`);
  }

  return data as NonNullable<R['data']>;
};

// One installed Slack workspace (a slack_teams row) per test. Every other row
// references it with ON DELETE CASCADE, so destroy() removes everything the
// test and the app created in it.
export class TestWorkspace implements ISlackWorkspace {
  private constructor(
    private readonly db: SupabaseClient<Database>,
    public readonly id: string,
    public readonly slackId: string,
    public readonly token: string,
  ) {}

  public static async create(db: SupabaseClient<Database>) {
    const teamSlackId = slackId('T');
    const token = `xoxb-test-${teamSlackId}`;

    const row = unwrap(
      await db
        .from('slack_teams')
        .insert({
          slack_id: teamSlackId,
          name: `Integration ${teamSlackId}`,
          slack_token: token,
        })
        .select()
        .single(),
    );

    return new TestWorkspace(db, row.id, teamSlackId, token);
  }

  public async addUser(
    fields: Partial<TablesInsert<'users'>> = {},
  ): Promise<Tables<'users'>> {
    const userSlackId = fields.slack_id ?? slackId('U');

    return unwrap(
      await this.db
        .from('users')
        .insert({
          slack_id: userSlackId,
          slack_team_id: this.id,
          name: `User ${userSlackId}`,
          email: `${userSlackId.toLowerCase()}@example.test`,
          role: UserRole.Member,
          ...fields,
        })
        .select()
        .single(),
    );
  }

  public async addVacationPolicy(
    fields: Partial<TablesInsert<'vacation_policies'>> = {},
  ): Promise<Tables<'vacation_policies'>> {
    return unwrap(
      await this.db
        .from('vacation_policies')
        .insert({
          slack_team_id: this.id,
          name: `Policy ${randomUUID().slice(0, 8)}`,
          ...fields,
        })
        .select()
        .single(),
    );
  }

  // An approved annual leave of `user`, unless `fields` says otherwise.
  public async addVacationRequest(
    user: Tables<'users'>,
    fields: Partial<TablesInsert<'vacation_requests'>> &
      Pick<TablesInsert<'vacation_requests'>, 'start_date' | 'end_date'>,
  ): Promise<Tables<'vacation_requests'>> {
    return unwrap(
      await this.db
        .from('vacation_requests')
        .insert({
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
        .select()
        .single(),
    );
  }

  public async addTeam(
    fields: Partial<TablesInsert<'teams'>> = {},
  ): Promise<Tables<'teams'>> {
    return unwrap(
      await this.db
        .from('teams')
        .insert({
          slack_team_id: this.id,
          name: `Team ${randomUUID().slice(0, 8)}`,
          ...fields,
        })
        .select()
        .single(),
    );
  }

  public async addClient(
    fields: Partial<TablesInsert<'clients'>> = {},
  ): Promise<Tables<'clients'>> {
    return unwrap(
      await this.db
        .from('clients')
        .insert({
          slack_team_id: this.id,
          name: `Client ${randomUUID().slice(0, 8)}`,
          ...fields,
        })
        .select()
        .single(),
    );
  }

  public async addProject(
    fields: Partial<TablesInsert<'projects'>> = {},
  ): Promise<Tables<'projects'>> {
    return unwrap(
      await this.db
        .from('projects')
        .insert({
          slack_team_id: this.id,
          name: `Project ${randomUUID().slice(0, 8)}`,
          ...fields,
        })
        .select()
        .single(),
    );
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
      unwrap(
        await this.db
          .from('project_teams')
          .insert(teams.map((team) => ({ ...link, team_id: team.id })))
          .select(),
      );
    }

    if (users.length) {
      unwrap(
        await this.db
          .from('project_users')
          .insert(users.map((user) => ({ ...link, user_id: user.id })))
          .select(),
      );
    }
  }

  // An hour of today's work by `user` on `project`, unless `fields` says otherwise.
  public async addTimeEntry(
    user: Tables<'users'>,
    project: Tables<'projects'>,
    fields: Partial<TablesInsert<'time_entries'>> = {},
  ): Promise<Tables<'time_entries'>> {
    return unwrap(
      await this.db
        .from('time_entries')
        .insert({
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
        .select()
        .single(),
    );
  }

  // Many entries in one insert, each an hour of today's work unless its
  // fields say otherwise.
  public async addTimeEntries(
    user: Tables<'users'>,
    project: Tables<'projects'>,
    entries: Partial<TablesInsert<'time_entries'>>[],
  ): Promise<void> {
    unwrap(
      await this.db
        .from('time_entries')
        .insert(
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
        .select('id'),
    );
  }

  public async rows<T extends Exclude<TableName, 'slack_teams'>>(
    table: T,
  ): Promise<Tables<T>[]> {
    // The generic table name is too much for supabase-js typings.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = this.db.from(table) as any;

    return unwrap(await query.select('*').eq('slack_team_id', this.id));
  }

  public async row<T extends Exclude<TableName, 'slack_teams'>>(
    table: T,
    id: string,
  ): Promise<Tables<T>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const query = this.db.from(table) as any;

    return unwrap(
      await query
        .select('*')
        .eq('slack_team_id', this.id)
        .eq('id', id)
        .single(),
    );
  }

  public async destroy() {
    unwrap(
      await this.db.from('slack_teams').delete().eq('id', this.id).select(),
    );
  }
}
