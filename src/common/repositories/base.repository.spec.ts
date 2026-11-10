import { BaseRepository } from '@common/repositories/base.repository';
import { SqlRow } from '@common/types/sql-database.types';
import { recordingDatabase } from 'src/database/testing/recording-database';

class ClientsRepository extends BaseRepository<'clients', SqlRow<'clients'>> {
  protected readonly tableName = 'clients';
  protected searchableColumns = ['name', 'description'];
  protected mapToViewModel = (row: SqlRow<'clients'>) => row;

  public deleteOne(id: string, slackTeamId: string) {
    return this.deleteInWorkspace(slackTeamId)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
  }
}

class TeamsRepository extends BaseRepository<'teams', SqlRow<'teams'>> {
  protected readonly tableName = 'teams';
  protected relations = {
    vacation_policy: {
      table: 'vacation_policies' as const,
      foreignKey: 'vacation_policy_id',
      columns: ['id', 'name'],
    },
  };
  protected mapToViewModel = (row: SqlRow<'teams'>) => row;
}

class WorkspacesRepository extends BaseRepository<
  'slack_teams',
  SqlRow<'slack_teams'>
> {
  protected readonly tableName = 'slack_teams';
  protected readonly workspaceColumn = null;
  protected mapToViewModel = (row: SqlRow<'slack_teams'>) => row;
}

describe('BaseRepository', () => {
  const workspace = { slack_team_id: 'w1' };

  describe("a workspace's table", () => {
    const { database, queries } = recordingDatabase();
    const clients = new ClientsRepository(database);

    it.each([
      ['findOne', () => clients.findOne({ id: 'c1' })],
      ['findMany', () => clients.findMany({ name: 'Acme' })],
      ['search', () => clients.search({ filters: { name: 'Acme' } })],
      [
        'count',
        () => clients.count({ name: 'Acme', slack_team_id: undefined }),
      ],
      ['update', () => clients.update({ id: 'c1' }, { name: 'New' })],
      ['updateMany', () => clients.updateMany({ id: 'c1' }, { name: 'New' })],
      ['deleteMany', () => clients.deleteMany({ id: 'c1' })],
    ])('refuses %s without the workspace', async (operation, query) => {
      await expect(query()).rejects.toThrow(
        `[clients] ${operation} without slack_team_id`,
      );
      expect(queries).toEqual([]);
    });

    it('refuses rows without the workspace', async () => {
      const row = { name: 'Acme' } as SqlRow<'clients'>;

      await expect(clients.create(row)).rejects.toThrow(
        '[clients] create without slack_team_id',
      );
      await expect(clients.createMany([row])).rejects.toThrow(
        '[clients] createMany without slack_team_id',
      );
      await expect(clients.upsert(row)).rejects.toThrow(
        '[clients] upsert without slack_team_id',
      );
      expect(queries).toEqual([]);
    });

    it('refuses a query of its own without the workspace', () => {
      expect(() => clients.deleteOne('c1', '')).toThrow(
        '[clients] query without slack_team_id',
      );
    });
  });

  it('refuses a query on the workspaces without a filter', async () => {
    const workspaces = new WorkspacesRepository(recordingDatabase().database);

    await expect(workspaces.findOne({ id: undefined })).rejects.toThrow(
      '[slack_teams] findOne without a filter',
    );
    await expect(workspaces.deleteMany({})).rejects.toThrow(
      '[slack_teams] deleteMany without a filter',
    );
  });

  it('turns filters into one parameterized condition', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase();

    await new ClientsRepository(database).findMany({
      ...workspace,
      archived_at: { operator: 'is', value: null },
      created_by: null,
      id: ['c1', 'c2'],
      name: [
        { operator: 'neq', value: 'Acme' },
        { operator: 'ilike', value: 'G%' },
      ],
      description: undefined,
    });

    expect(sqlOf(0)).toBe(
      'select "clients".* from "clients" where ("slack_team_id" = $1 and "archived_at" is null and "created_by" is null and "id" in ($2, $3) and "name" <> $4 and "name" ilike $5) order by "created_at" desc, "id" asc',
    );
    expect(parametersOf(0)).toEqual(['w1', 'c1', 'c2', 'Acme', 'G%']);
  });

  it('matches no row for an empty list, instead of every row', async () => {
    const { database, sqlOf } = recordingDatabase([[{ count: 0 }]]);

    await new ClientsRepository(database).count({ ...workspace, id: [] });

    expect(sqlOf(0)).toBe(
      'select count(*) as "count" from "clients" where ("slack_team_id" = $1 and false)',
    );
  });

  it('uses the array operators for cs, cd and ov', async () => {
    const { database, sqlOf } = recordingDatabase();

    await new TeamsRepository(database).findMany({
      ...workspace,
      manager_approvers: { operator: 'ov', value: ['U1'] },
      hr_approvers: [
        { operator: 'cs', value: ['U2'] },
        { operator: 'cd', value: ['U2', 'U3'] },
      ],
    });

    expect(sqlOf(0)).toContain(
      '"manager_approvers" && $2 and "hr_approvers" @> $3 and "hr_approvers" <@ $4',
    );
  });

  it('pages with limit and offset and ends the order with the id', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase();

    await new ClientsRepository(database).findMany(workspace, {
      orderBy: ['name:asc'],
      limit: 1500,
      offset: 10,
    });

    expect(sqlOf(0)).toMatch(
      /order by "name" asc, "id" asc limit \$2 offset \$3$/,
    );
    expect(parametersOf(0)).toEqual(['w1', 1500, 10]);
  });

  it('searches the searchable columns for the term as text', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase([
      [],
      [{ count: 0 }],
    ]);

    await new ClientsRepository(database).search({
      filters: workspace,
      searchTerm: '50%_off\\',
    });

    expect(sqlOf(0)).toContain(
      'where ("slack_team_id" = $1 and ("name" ilike $2 or "description" ilike $3))',
    );
    expect(parametersOf(0).slice(1, 3)).toEqual([
      '%50\\%\\_off\\\\%',
      '%50\\%\\_off\\\\%',
    ]);
  });

  it('returns null when no row matches, and refuses several', async () => {
    const { database } = recordingDatabase([[], [{ id: 'c1' }, { id: 'c2' }]]);
    const clients = new ClientsRepository(database);

    await expect(clients.findOne(workspace)).resolves.toBeNull();
    await expect(clients.findOne(workspace)).rejects.toThrow(
      '[clients] findOne error: the filter matches several rows',
    );
  });

  it('updates only when the filter matches exactly one row', async () => {
    const { database, sqlOf } = recordingDatabase([[], [{ count: 2 }]]);

    await expect(
      new ClientsRepository(database).update(workspace, { name: 'New' }),
    ).rejects.toThrow('[clients] update error: the filter matches 2 rows');
    expect(sqlOf(0)).toBe(
      'update "clients" set "name" = $1 where ("slack_team_id" = $2 and (select count(*) as "count" from "clients" as "matching" where "slack_team_id" = $3) = $4) returning *',
    );
  });

  it('upserts every given column on a conflict', async () => {
    const { database, sqlOf } = recordingDatabase([[{ id: 'c1' }]]);

    await new ClientsRepository(database).upsert(
      { id: 'c1', name: 'Acme', slack_team_id: 'w1' },
      'id',
    );

    expect(sqlOf(0)).toBe(
      'insert into "clients" ("id", "name", "slack_team_id") values ($1, $2, $3) on conflict ("id") do update set "id" = "excluded"."id", "name" = "excluded"."name", "slack_team_id" = "excluded"."slack_team_id" returning *',
    );
  });

  it('keeps the columns an upsert leaves undefined', async () => {
    const { database, sqlOf } = recordingDatabase([[{ id: 'c1' }]]);

    await new ClientsRepository(database).upsert(
      {
        id: 'c1',
        name: 'Acme',
        slack_team_id: 'w1',
        description: undefined,
      },
      ['id'],
    );

    expect(sqlOf(0)).not.toContain('description');
  });

  it('embeds a relation as an object, also in the rows it writes', async () => {
    const { database, sqlOf } = recordingDatabase([[], [{ id: 't1' }]]);
    const teams = new TeamsRepository(database);

    await teams.findMany(workspace);
    await teams.create({ name: 'Ops', slack_team_id: 'w1' });

    expect(sqlOf(0)).toBe(
      'select "teams".*, (select to_json(obj) from (select "id", "name" from "vacation_policies" as "vacation_policy" where "vacation_policy"."id" = "teams"."vacation_policy_id") as obj) as "vacation_policy" from "teams" where "slack_team_id" = $1 order by "created_at" desc, "id" asc',
    );
    expect(sqlOf(1)).toBe(
      'with "written" as (insert into "teams" ("name", "slack_team_id") values ($1, $2) returning *) select "written".*, (select to_json(obj) from (select "id", "name" from "vacation_policies" as "vacation_policy" where "vacation_policy"."id" = "written"."vacation_policy_id") as obj) as "vacation_policy" from "written"',
    );
  });

  it('scopes the queries a subclass writes to the workspace', async () => {
    const { database, sqlOf, parametersOf } = recordingDatabase();

    await new ClientsRepository(database).deleteOne('c1', 'w1');

    expect(sqlOf(0)).toBe(
      'delete from "clients" where "slack_team_id" = $1 and "id" = $2 returning *',
    );
    expect(parametersOf(0)).toEqual(['w1', 'c1']);
  });

  it('names the table and the operation when the database fails', async () => {
    const { database } = recordingDatabase();
    jest.spyOn(database.db, 'selectFrom').mockImplementation(() => {
      throw Object.assign(new Error('connection refused'), {
        code: 'ECONNREFUSED',
      });
    });

    const failure = new ClientsRepository(database).count(workspace);

    await expect(failure).rejects.toThrow(
      '[clients] count error: connection refused',
    );
    await expect(failure).rejects.toMatchObject({
      cause: { code: 'ECONNREFUSED' },
    });
  });
});
