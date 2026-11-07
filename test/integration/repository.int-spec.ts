import { ClientsRepository } from '@modules/clients/repositories/clients.repository';
import { PAGE_SIZE } from '@common/repositories/base.repository';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';

// BaseRepository against the real PostgREST, which returns at most max_rows
// (1000) rows per request and says nothing about the rest.
describe('BaseRepository', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let clients: ClientsRepository;

  beforeAll(async () => {
    t = await createTestApp();
    clients = t.app.get(ClientsRepository);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  // All rows share one created_at, so only the id keeps pages apart.
  const addClients = async (count: number) => {
    const createdAt = new Date().toISOString();
    const { error } = await t.db.from('clients').insert(
      Array.from({ length: count }, (_, index) => ({
        slack_team_id: workspace.id,
        name: `Client ${String(index).padStart(4, '0')}`,
        created_at: createdAt,
      })),
    );

    expect(error).toBeNull();
  };

  it('finds more rows than PostgREST returns at once', async () => {
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

  it('deletes more rows than PostgREST returns at once and counts them', async () => {
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
});
