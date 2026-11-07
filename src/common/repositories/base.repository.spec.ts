import {
  BaseRepository,
  quoteFilterValue,
  TableName,
  Tables,
} from '@common/repositories/base.repository';
import { SupabaseService } from 'src/database/supabase.service';

// No query reaches the client in these tests: the checks run first.
const supabase = {
  getClient: () => ({}),
} as unknown as SupabaseService;

class ClientsRepository extends BaseRepository<Tables['clients'], unknown> {
  protected tableName: TableName = 'clients';
}

class WorkspacesRepository extends BaseRepository<
  Tables['slack_teams'],
  unknown
> {
  protected tableName: TableName = 'slack_teams';
  protected readonly workspaceColumn = null;
}

interface IAnswer {
  data: unknown;
  error: { message: string } | null;
}

// A PostgREST query builder that records the calls of each query and answers
// the queries in turn, whether awaited or through maybeSingle().
const fakeSupabase = (answers: IAnswer[]) => {
  const queries: { method: string; args: unknown[] }[][] = [];
  const next = () =>
    Promise.resolve(answers.shift() ?? { data: [], error: null });
  const client = {
    from: () => {
      const calls: { method: string; args: unknown[] }[] = [];
      const builder: Record<string, unknown> = {
        maybeSingle: next,
        then: (
          resolve: (answer: IAnswer) => unknown,
          reject: (error: unknown) => unknown,
        ) => next().then(resolve, reject),
      };

      for (const method of ['select', 'eq', 'in', 'range', 'limit', 'order']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });

          return builder;
        };
      }

      queries.push(calls);

      return builder;
    },
  };

  return {
    service: { getClient: () => client } as unknown as SupabaseService,
    callsOf: (query: number, method: string) =>
      queries[query]
        .filter((call) => call.method === method)
        .map(({ args }) => args),
  };
};

class ClientRowsRepository extends BaseRepository<
  Tables['clients'],
  Tables['clients']['Row']
> {
  protected tableName: TableName = 'clients';
  protected mapToViewModel = (row: Tables['clients']['Row']) => row;
}

const rows = (count: number, from = 0) =>
  Array.from({ length: count }, (_, index) => ({ id: `c${from + index}` }));

describe('BaseRepository', () => {
  const workspace = { slack_team_id: 'w1' };

  describe('findOne', () => {
    it('returns null when no row matches', async () => {
      const { service } = fakeSupabase([{ data: null, error: null }]);

      expect(await new ClientRowsRepository(service).findOne(workspace)).toBe(
        null,
      );
    });

    // A failed query used to read as "not found": during an outage a known
    // user got 401 and nothing was logged.
    it('throws when the query fails', async () => {
      const { service } = fakeSupabase([
        { data: null, error: { message: 'connection refused' } },
      ]);

      await expect(
        new ClientRowsRepository(service).findOne(workspace),
      ).rejects.toThrow('[clients] findOne error: connection refused');
    });
  });

  describe('findMany', () => {
    // PostgREST cuts every answer to 1000 rows without an error.
    it('reads all rows in pages of 1000', async () => {
      const { service, callsOf } = fakeSupabase([
        { data: rows(1000), error: null },
        { data: rows(1, 1000), error: null },
      ]);

      const found = await new ClientRowsRepository(service).findMany(workspace);

      expect(found).toHaveLength(1001);
      expect(callsOf(0, 'range')).toEqual([[0, 999]]);
      expect(callsOf(1, 'range')).toEqual([[1000, 1999]]);
    });

    it('reads only as many rows as the limit asks for', async () => {
      const { service, callsOf } = fakeSupabase([
        { data: rows(1000), error: null },
        { data: rows(500, 1000), error: null },
      ]);

      const found = await new ClientRowsRepository(service).findMany(
        workspace,
        { limit: 1500, offset: 10 },
      );

      expect(found).toHaveLength(1500);
      expect(callsOf(0, 'range')).toEqual([[10, 1009]]);
      expect(callsOf(1, 'range')).toEqual([[1010, 1509]]);
    });

    it('ends the order with the id, so pages fit together', async () => {
      const { service, callsOf } = fakeSupabase([{ data: [], error: null }]);

      await new ClientRowsRepository(service).findMany(workspace, {
        orderBy: ['name:asc'],
      });

      expect(callsOf(0, 'order')).toEqual([
        ['name', { ascending: true }],
        ['id', { ascending: true }],
      ]);
    });

    it('throws when a page fails', async () => {
      const { service } = fakeSupabase([
        { data: rows(1000), error: null },
        { data: null, error: { message: 'timeout' } },
      ]);

      await expect(
        new ClientRowsRepository(service).findMany(workspace),
      ).rejects.toThrow('[clients] findMany error: timeout');
    });
  });

  describe("a workspace's table", () => {
    const clients = new ClientsRepository(supabase);

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
    });

    it('refuses rows without the workspace', async () => {
      const row = { name: 'Acme' } as Tables['clients']['Insert'];

      await expect(clients.create(row)).rejects.toThrow(
        '[clients] create without slack_team_id',
      );
      await expect(clients.createMany([row])).rejects.toThrow(
        '[clients] createMany without slack_team_id',
      );
      await expect(clients.upsert(row)).rejects.toThrow(
        '[clients] upsert without slack_team_id',
      );
    });
  });

  it('refuses a query on the workspaces without a filter', async () => {
    const workspaces = new WorkspacesRepository(supabase);

    await expect(workspaces.findOne({ id: undefined })).rejects.toThrow(
      '[slack_teams] findOne without a filter',
    );
    await expect(workspaces.deleteMany({})).rejects.toThrow(
      '[slack_teams] deleteMany without a filter',
    );
  });

  it('quotes a filter value, so its commas and dots stay text', () => {
    expect(quoteFilterValue('%a,id.not.is.null%')).toBe('"%a,id.not.is.null%"');
    expect(quoteFilterValue('say "hi" \\ bye')).toBe('"say \\"hi\\" \\\\ bye"');
  });
});
