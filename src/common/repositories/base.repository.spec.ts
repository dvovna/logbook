import {
  BaseRepository,
  TableName,
  Tables,
} from 'src/common/repositories/base.repository';
import { SupabaseService } from 'src/database/supabase.service';

type QueryCall = [method: string, ...args: unknown[]];

interface IQueryResult {
  data: unknown;
  error: { message: string } | null;
  count?: number | null;
}

const QUERY_METHODS = [
  'select',
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'like',
  'ilike',
  'is',
  'not',
  'contains',
  'containedBy',
  'overlaps',
  'range',
  'limit',
  'order',
  'or',
];

const NON_FILTER_METHODS = ['select', 'range', 'limit', 'order'];

// Chainable stand-in for the Supabase query builder that records every call
// and resolves to `result` when awaited.
const createQueryBuilder = (result: IQueryResult) => {
  const calls: QueryCall[] = [];
  const builder: Record<string, unknown> = {
    then: (
      resolve: (value: IQueryResult) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };

  for (const method of QUERY_METHODS) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }

  return { builder, calls };
};

class TestRepository extends BaseRepository<Tables['users'], { id: string }> {
  protected tableName: TableName = 'users';

  protected searchableColumns = ['name', 'email'];

  protected mapToViewModel = (row: Tables['users']['Row']) => ({ id: row.id });
}

describe('BaseRepository', () => {
  let calls: QueryCall[];
  let from: jest.Mock;
  let repository: TestRepository;

  const setup = (result: IQueryResult) => {
    const query = createQueryBuilder(result);
    calls = query.calls;
    from = jest.fn().mockReturnValue(query.builder);

    const supabaseService = { getClient: () => ({ from }) };
    repository = new TestRepository(
      supabaseService as unknown as SupabaseService,
    );
  };

  const filterCalls = () =>
    calls.filter(([method]) => !NON_FILTER_METHODS.includes(method));

  beforeEach(() => setup({ data: [{ id: 'user-1' }], error: null }));

  describe('findMany filters', () => {
    it('uses eq for plain values and skips undefined ones', async () => {
      const result = await repository.findMany({
        slack_team_id: 'team-1',
        team_id: undefined,
        is_active: true,
      });

      expect(from).toHaveBeenCalledWith('users');
      expect(filterCalls()).toEqual([
        ['eq', 'slack_team_id', 'team-1'],
        ['eq', 'is_active', true],
      ]);
      expect(result).toEqual([{ id: 'user-1' }]);
    });

    it('maps operator filters to query builder methods', async () => {
      await repository.findMany({
        role: { operator: 'in', value: ['admin', 'hr'] },
        completed_at: { operator: 'not.is', value: null },
        manager_approvers: { operator: 'ov', value: ['U1'] },
        name: { operator: 'ilike', value: '%ann%' },
      });

      expect(filterCalls()).toEqual([
        ['in', 'role', ['admin', 'hr']],
        ['not', 'completed_at', 'is', null],
        ['overlaps', 'manager_approvers', ['U1']],
        ['ilike', 'name', '%ann%'],
      ]);
    });

    it('applies every operator from an array of filters on one column', async () => {
      await repository.findMany({
        date: [
          { operator: 'gte', value: '2026-01-01' },
          { operator: 'lte', value: '2026-12-31' },
        ],
      });

      expect(filterCalls()).toEqual([
        ['gte', 'date', '2026-01-01'],
        ['lte', 'date', '2026-12-31'],
      ]);
    });

    it('uses in for a plain array of values', async () => {
      await repository.findMany({ id: ['user-1', 'user-2'] });

      expect(filterCalls()).toEqual([['in', 'id', ['user-1', 'user-2']]]);
    });

    it('skips empty arrays', async () => {
      await repository.findMany({ id: [] });

      expect(filterCalls()).toEqual([]);
    });

    it('limits and orders by created_at desc by default', async () => {
      await repository.findMany({});

      expect(calls).toContainEqual(['limit', 10000]);
      expect(calls).toContainEqual([
        'order',
        'created_at',
        { ascending: false },
      ]);
    });

    it('throws with the table name when the query fails', async () => {
      setup({ data: null, error: { message: 'boom' } });

      await expect(repository.findMany({})).rejects.toThrow(
        '[users] findAll error: boom',
      );
    });
  });

  describe('search', () => {
    it('paginates with range and returns the total count', async () => {
      setup({ data: [{ id: 'user-1' }], error: null, count: 42 });

      const result = await repository.search({
        page: 2,
        pageSize: 10,
        filters: { slack_team_id: 'team-1' },
      });

      expect(calls).toContainEqual(['range', 10, 19]);
      expect(calls).toContainEqual([
        'order',
        'created_at',
        { ascending: false },
      ]);
      expect(result).toEqual({
        items: [{ id: 'user-1' }],
        totalCount: 42,
        page: 2,
        pageSize: 10,
      });
    });

    it('matches the search term in any searchable column', async () => {
      await repository.search({ searchTerm: 'ann', filters: {} });

      expect(filterCalls()).toEqual([
        ['or', 'name.ilike.%ann%,email.ilike.%ann%'],
      ]);
    });
  });
});
