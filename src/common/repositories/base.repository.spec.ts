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

describe('BaseRepository', () => {
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
