import { sortBy } from 'lodash';
import UserRole from '@common/enums/user-role.enum';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { JobsService } from '@common/jobs/jobs.service';
import {
  BaseRepository,
  TableName,
  Tables as SupabaseTables,
} from '@common/repositories/base.repository';
import { SqlRepository } from '@common/repositories/sql.repository';
import { Tables } from '@common/types/database.types';
import { SqlRow } from '@common/types/sql-database.types';
import { ClientsRepository } from '@modules/clients/repositories/clients.repository';
import ClientsService from '@modules/clients/services/clients.service';
import { NOTIFY_REJECTED_JOB } from '@modules/slack/tabs/approvals/services/time-entry-notifications.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DatabaseService } from 'src/database/database.service';
import { SupabaseService } from 'src/database/supabase.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';

type TeamWithPolicy = Tables<'teams'> & {
  vacation_policy: { id: string; name: string } | null;
};

class PostgrestTeams extends BaseRepository<
  SupabaseTables['teams'],
  TeamWithPolicy
> {
  protected tableName: TableName = 'teams';
  protected relations = { vacation_policy: 'vacation_policy_id ( id, name )' };
  protected mapToViewModel = (row: Tables<'teams'>) => row as TeamWithPolicy;
}

class SqlTeams extends SqlRepository<'teams', TeamWithPolicy> {
  protected readonly tableName = 'teams';
  protected relations = {
    vacation_policy: {
      table: 'vacation_policies' as const,
      foreignKey: 'vacation_policy_id',
      columns: ['id', 'name'],
    },
  };
  protected mapToViewModel = (row: SqlRow<'teams'>) => row as TeamWithPolicy;
}

// What the direct connection (DatabaseService) adds to PostgREST, and that
// it reads the same data the same way.
describe('The direct Postgres connection', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let database: DatabaseService;
  let clients: ClientsRepository;

  beforeAll(async () => {
    t = await createTestApp();
    database = t.app.get(DatabaseService);
    clients = t.app.get(ClientsRepository);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  const newClient = (name: string) => ({
    slack_team_id: workspace.id,
    name,
  });

  describe('reads rows as PostgREST does', () => {
    it.each([
      'clients',
      'teams',
      'users',
      'vacation_policies',
      'time_entries',
    ] as const)('%s', async (table) => {
      const policy = await workspace.addVacationPolicy();
      const team = await workspace.addTeam({
        vacation_policy_id: policy.id,
        manager_approvers: ['U1', 'U2'],
      });
      const user = await workspace.addUser({
        team_id: team.id,
        contract_start_date: '2024-03-01',
      });
      const client = await workspace.addClient({
        archived_at: '2026-06-17T10:11:12.345678+00:00',
      });
      const project = await workspace.addProject({ client_id: client.id });
      await workspace.addTimeEntry(user, project, { work_date: '2026-06-15' });

      const direct = await database.db
        .selectFrom(table)
        .selectAll()
        .where('slack_team_id', '=', workspace.id)
        .orderBy('id')
        .execute();
      const throughPostgrest = sortBy(await workspace.rows(table), 'id');

      expect(direct).not.toEqual([]);
      expect(direct).toEqual(throughPostgrest);
    });

    it('embeds relations as PostgREST does', async () => {
      const policy = await workspace.addVacationPolicy({ name: 'Standard' });
      await workspace.addTeam({ vacation_policy_id: policy.id });
      await workspace.addTeam();
      const filter = { slack_team_id: workspace.id };

      const direct = await new SqlTeams(database).findMany(filter);

      expect(direct.map((team) => team.vacation_policy)).toEqual([
        null,
        { id: policy.id, name: 'Standard' },
      ]);
      expect(direct).toEqual(
        await new PostgrestTeams(t.app.get(SupabaseService)).findMany(filter),
      );
    });
  });

  describe('transactions', () => {
    it('rolls back every write of a transaction that fails', async () => {
      await expect(
        database.transaction(async () => {
          await clients.create(newClient('Acme'));
          await database.db
            .insertInto('teams')
            .values({ slack_team_id: workspace.id, name: 'Ops' })
            .execute();

          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');

      expect(await workspace.rows('clients')).toEqual([]);
      expect(await workspace.rows('teams')).toEqual([]);
    });

    it('commits every write of a transaction that succeeds', async () => {
      await database.transaction(async () => {
        await clients.create(newClient('Acme'));
        await clients.create(newClient('Globex'));
      });

      expect(
        (await workspace.rows('clients')).map(({ name }) => name).sort(),
      ).toEqual(['Acme', 'Globex']);
    });

    it('runs work after the commit, when others can see the data', async () => {
      const seen: string[][] = [];
      const afterCommit = () =>
        workspace
          .rows('clients')
          .then((rows) => seen.push(rows.map(({ name }) => name)));

      await database.transaction(async () => {
        await clients.create(newClient('Acme'));
        database.afterCommit(afterCommit);
      });
      await expect(
        database.transaction(async () => {
          await clients.create(newClient('Globex'));
          database.afterCommit(afterCommit);

          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      await t.idle();

      expect(seen).toEqual([['Acme']]);
    });

    it('lets only as many clients in as the limit when admins add them at once', async () => {
      const admin = (await workspace.addUser({
        role: UserRole.Admin,
      })) as unknown as IUserViewModel;
      // MAX_CLIENTS_PER_SLACK_TEAM is 10 in the tests.
      for (let index = 0; index < 9; index += 1) {
        await workspace.addClient();
      }
      const service = t.app.get(ClientsService);

      const results = await Promise.allSettled(
        ['A', 'B', 'C'].map((name) =>
          service.create({ name, slackTeamId: workspace.id }, admin),
        ),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(
        results
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map(({ reason }) => reason as Error),
      ).toEqual([
        expect.any(MaxItemsCountReachedError),
        expect.any(MaxItemsCountReachedError),
      ]);
      expect(await workspace.rows('clients')).toHaveLength(10);
    });
  });

  // A change and the job about it in one transaction: the job exists exactly
  // when the change was committed. Rejecting a time entry DMs its owner.
  describe('a job saved in the same transaction', () => {
    let owner: Tables<'users'>;
    let reviewer: Tables<'users'>;
    let entry: Tables<'time_entries'>;

    beforeEach(async () => {
      owner = await workspace.addUser({ name: 'Max Member' });
      reviewer = await workspace.addUser({ role: UserRole.HR });
      const project = await workspace.addProject({ name: 'Website' });
      entry = await workspace.addTimeEntry(owner, project, {
        status: TimeEntryStatus.Submitted,
      });
    });

    const reject = () =>
      database.transaction(async () => {
        await database.db
          .updateTable('time_entries')
          .set({ status: TimeEntryStatus.Rejected })
          .where('slack_team_id', '=', workspace.id)
          .where('id', '=', entry.id)
          .execute();
        await t.app.get(JobsService).enqueue(NOTIFY_REJECTED_JOB, {
          timeEntryId: entry.id,
          slackTeamId: workspace.id,
          reviewerId: reviewer.id,
        });
      });

    const messagesToOwner = () =>
      t.slackApi.postedMessages(workspace.token, owner.slack_id);

    it('runs the job once the change is committed', async () => {
      await reject();
      await t.idle();
      await t.retryJobs();

      expect(messagesToOwner()).toHaveLength(1);
      expect(messagesToOwner()[0].text).toContain('rejected your time entry');
    });

    it('saves no job when the change is rolled back', async () => {
      await expect(
        database.transaction(async () => {
          await reject();

          throw new Error('rolled back');
        }),
      ).rejects.toThrow('rolled back');
      await t.idle();
      await t.retryJobs();

      expect(messagesToOwner()).toEqual([]);
      expect(await workspace.row('time_entries', entry.id)).toMatchObject({
        status: TimeEntryStatus.Submitted,
      });
    });

    it('retries the job when its first run fails', async () => {
      t.slackApi.failNext('chat.postMessage');

      await reject();
      await t.idle();
      expect(messagesToOwner()).toEqual([]);

      await t.retryJobs();
      expect(messagesToOwner()).toHaveLength(1);
    });
  });
});
