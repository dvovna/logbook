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
