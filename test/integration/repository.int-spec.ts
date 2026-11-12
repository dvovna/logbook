import { ClientsRepository } from '@modules/clients/repositories/clients.repository';
import { DatabaseService } from 'src/database/database.service';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';

class SearchableClientsRepository extends ClientsRepository {
  protected searchableColumns = ['name'];
}

// PostgREST returned at most 1000 rows per request and said nothing about the
// rest; the repositories read and write every row a filter matches.
const PAGE_SIZE = 1000;

// The repositories' generic methods against the real database
// (ClientsRepository, searching names here).
describe('Repositories', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let clients: SearchableClientsRepository;

  beforeAll(async () => {
    t = await createTestApp();
    clients = new SearchableClientsRepository(t.app.get(DatabaseService));
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  // All rows share one created_at, so only the id keeps pages apart.
  const addClients = async (count: number) => {
    const createdAt = new Date().toISOString();
    await t.db
      .insertInto('clients')
      .values(
        Array.from({ length: count }, (_, index) => ({
          slack_team_id: workspace.id,
          name: `Client ${String(index).padStart(4, '0')}`,
          created_at: createdAt,
        })),
      )
      .execute();
  };

  it('finds more rows than PostgREST returned at once', async () => {
    await addClients(PAGE_SIZE + 1);

    const found = await clients.findMany({ slack_team_id: workspace.id });

    expect(found).toHaveLength(PAGE_SIZE + 1);
    expect(new Set(found.map(({ id }) => id)).size).toBe(PAGE_SIZE + 1);
    expect(await clients.count({ slack_team_id: workspace.id })).toBe(
      PAGE_SIZE + 1,
    );
  });

  it('keeps a limit and an offset across pages', async () => {
    await addClients(PAGE_SIZE + 5);

    const found = await clients.findMany(
      { slack_team_id: workspace.id },
      { orderBy: ['name:asc'], offset: 3, limit: PAGE_SIZE + 1 },
    );

    expect(found).toHaveLength(PAGE_SIZE + 1);
    expect(found[0].name).toBe('Client 0003');
    expect(found[PAGE_SIZE].name).toBe(`Client ${PAGE_SIZE + 3}`);
  });

  it('deletes more rows than PostgREST returned at once and counts them', async () => {
    await addClients(PAGE_SIZE + 1);

    await expect(
      clients.deleteMany({ slack_team_id: workspace.id }),
    ).resolves.toBe(PAGE_SIZE + 1);
    expect(await clients.count({ slack_team_id: workspace.id })).toBe(0);
  });

  it('matches no row for an empty list', async () => {
    await addClients(2);

    expect(
      await clients.findMany({ slack_team_id: workspace.id, id: [] }),
    ).toEqual([]);
    expect(await clients.count({ slack_team_id: workspace.id, id: [] })).toBe(
      0,
    );
  });

  // One bind parameter per value would stop at 65535.
  it('takes a list of more values than a statement takes parameters', async () => {
    await addClients(3);
    const [first, second] = await clients.findMany(
      { slack_team_id: workspace.id },
      { orderBy: ['name:asc'] },
    );
    const others = Array.from(
      { length: 70_000 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    );

    const found = await clients.findMany(
      { slack_team_id: workspace.id, id: [first.id, ...others, second.id] },
      { orderBy: ['name:asc'] },
    );
    const renamed = await clients.updateMany(
      {
        slack_team_id: workspace.id,
        name: { operator: 'in', value: [...others, first.name] },
      },
      { description: 'Renamed' },
    );

    expect(found.map(({ id }) => id)).toEqual([first.id, second.id]);
    expect(renamed.map(({ id }) => id)).toEqual([first.id]);
  });

  it('finds one row, or null when none matches', async () => {
    const acme = await workspace.addClient({ name: 'Acme' });

    expect(
      await clients.findOne({ slack_team_id: workspace.id, id: acme.id }),
    ).toMatchObject({ id: acme.id, name: 'Acme' });
    expect(
      await clients.findOne({ slack_team_id: workspace.id, name: 'Globex' }),
    ).toBeNull();
  });

  it('refuses findOne when the filter matches several rows', async () => {
    await addClients(2);

    await expect(
      clients.findOne({ slack_team_id: workspace.id }),
    ).rejects.toThrow('[clients] findOne error');
  });

  it('reports a database error instead of "not found"', async () => {
    await expect(
      clients.findOne({ slack_team_id: workspace.id, id: 'not-a-uuid' }),
    ).rejects.toThrow('[clients] findOne error');
  });

  it('updates one row, and changes nothing when the filter matches several', async () => {
    const acme = await workspace.addClient({ name: 'Acme' });
    await workspace.addClient({ name: 'Globex' });

    await expect(
      clients.update(
        { slack_team_id: workspace.id, id: acme.id },
        { description: 'Rockets' },
      ),
    ).resolves.toMatchObject({ id: acme.id, description: 'Rockets' });
    await expect(
      clients.update({ slack_team_id: workspace.id }, { description: 'All' }),
    ).rejects.toThrow('[clients] update error');
    await expect(
      clients.update(
        { slack_team_id: workspace.id, name: 'Initech' },
        { description: 'None' },
      ),
    ).rejects.toThrow('[clients] update error');

    expect(
      (await workspace.rows('clients')).map(({ description }) => description),
    ).not.toContain('All');
  });

  it('searches names for the term as text', async () => {
    await workspace.addClient({ name: 'Acme, Inc.' });
    await workspace.addClient({ name: 'Globex' });

    const result = await clients.search({
      filters: { slack_team_id: workspace.id },
      searchTerm: 'me, I',
    });

    expect(result.items.map(({ name }) => name)).toEqual(['Acme, Inc.']);
    expect(result.totalCount).toBe(1);
  });
});
