import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';

const HEADER = [
  'email',
  'contractStartDate',
  ...[0, 1].flatMap((i) =>
    ['startDate', 'endDate', 'type', 'status'].map(
      (field) => `vacation[${i}].${field}`,
    ),
  ),
].join(';');

// One line of user-vacations.csv: the user, the contract start and up to two
// vacations as [start, end, type, status]. Like a spreadsheet export, every
// line has all the columns.
const row = (
  email: string,
  contractStart: string,
  ...vacations: string[][]
) => {
  const cells = [email, contractStart, ...vacations.flat()];

  return [...cells, ...Array(10 - cells.length).fill('')].join(';');
};

// The admin shares user-vacations.csv in Slack; the app imports it and
// replaces the vacations of every user in it.
describe('user-vacations.csv', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let admin: Tables<'users'>;
  let ada: Tables<'users'>;
  let bob: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    admin = await workspace.addUser({ role: UserRole.Admin });
    const policy = await workspace.addVacationPolicy();
    const team = await workspace.addTeam({ vacation_policy_id: policy.id });
    await t.db.from('holidays').insert({
      slack_team_id: workspace.id,
      vacation_policy_id: policy.id,
      name: 'Holiday',
      date: '2026-03-04',
      year: 2026,
      created_by: admin.id,
    });
    ada = await workspace.addUser({
      email: 'ada@example.test',
      team_id: team.id,
    });
    bob = await workspace.addUser({ email: 'bob@example.test' });
  });

  // Shares the file and returns the app's reply to the admin.
  const importCsv = async (...rows: string[]) => {
    await t.slack
      .event(workspace, {
        type: 'file_shared',
        file_id: t.slackApi.addFile(
          'user-vacations.csv',
          [HEADER, ...rows].join('\n'),
        ),
        user_id: admin.slack_id,
        channel_id: 'D_TEST',
      })
      .expect(acknowledged);
    await t.idle();

    const [reply] = t.slackApi.ephemeralMessages(
      workspace.token,
      admin.slack_id,
    );

    return reply?.text;
  };

  const vacationsOf = async (user: Tables<'users'>) =>
    (await workspace.rows('vacation_requests'))
      .filter(({ user_id }) => user_id === user.id)
      .map(({ start_date, end_date, type, status, days, working_days }) => ({
        start_date,
        end_date,
        type,
        status,
        days,
        working_days,
      }))
      .sort((a, b) => a.start_date.localeCompare(b.start_date));

  it("replaces a user's vacations and sets the contract start", async () => {
    await workspace.addVacationRequest(ada, {
      start_date: '2026-01-05',
      end_date: '2026-01-09',
    });
    await workspace.addVacationRequest(bob, {
      start_date: '2026-01-05',
      end_date: '2026-01-09',
    });

    const reply = await importCsv(
      row(
        ada.email,
        '2025-09-01',
        ['2026-03-02', '2026-03-06', 'annual_leave', 'approved'],
        ['2026-04-01', '2026-04-01', 'sick_leave', 'pending'],
      ),
    );

    expect(reply).toBe(
      'Import was successful.\n Results: \nCreated: 0\nUpdated: 1\nSkipped: 0.',
    );
    // March 4 is a holiday of Ada's policy.
    expect(await vacationsOf(ada)).toEqual([
      {
        start_date: '2026-03-02',
        end_date: '2026-03-06',
        type: 'annual_leave',
        status: 'approved',
        days: 5,
        working_days: 4,
      },
      {
        start_date: '2026-04-01',
        end_date: '2026-04-01',
        type: 'sick_leave',
        status: 'pending',
        days: 1,
        working_days: 1,
      },
    ]);
    expect((await workspace.row('users', ada.id)).contract_start_date).toBe(
      '2025-09-01',
    );
    expect(await vacationsOf(bob)).toHaveLength(1);
  });

  it('imports nothing when a row is invalid', async () => {
    await workspace.addVacationRequest(ada, {
      start_date: '2026-01-05',
      end_date: '2026-01-09',
    });

    const reply = await importCsv(
      row(ada.email, '2025-09-01', [
        '2026-03-02',
        '2026-03-06',
        'annual_leave',
        'approved',
      ]),
      row(bob.email, '2025-09-01', [
        '2026-03-02',
        '2026-03-06',
        'holiday',
        'approved',
      ]),
    );

    expect(reply).toContain('Import was not successful');
    expect(reply).toContain(
      'Vacation 1 for bob@example.test is invalid: field type should be one of',
    );
    expect(await vacationsOf(ada)).toEqual([
      expect.objectContaining({ start_date: '2026-01-05' }),
    ]);
  });

  it('imports the users it knows and reports the others', async () => {
    const reply = await importCsv(
      row(ada.email, '2025-09-01', [
        '2026-03-02',
        '2026-03-06',
        'annual_leave',
        'approved',
      ]),
      row('ghost@example.test', '2025-09-01'),
    );

    expect(reply).toBe(
      'Import was not successful: \n User not found: ghost@example.test',
    );
    expect(await vacationsOf(ada)).toHaveLength(1);
  });

  it('does not import users of another workspace', async () => {
    const other = await t.createWorkspace();
    const stranger = await other.addUser({ email: 'stranger@example.test' });

    const reply = await importCsv(
      row(stranger.email, '2025-09-01', [
        '2026-03-02',
        '2026-03-06',
        'annual_leave',
        'approved',
      ]),
    );

    expect(reply).toContain('User not found: stranger@example.test');
    expect(await other.rows('vacation_requests')).toEqual([]);
  });

  describe('shared files', () => {
    // Shares a file as `user` and returns the app's reply to them, if any.
    const share = async (
      user: Tables<'users'>,
      name: string,
      content: string,
      size?: number,
    ) => {
      await t.slack
        .event(workspace, {
          type: 'file_shared',
          file_id: t.slackApi.addFile(name, content, { size }),
          user_id: user.slack_id,
          channel_id: 'D_TEST',
        })
        .expect(acknowledged);
      await t.idle();

      const [reply] = t.slackApi.ephemeralMessages(
        workspace.token,
        user.slack_id,
      );

      return reply?.text;
    };

    const downloads = () =>
      t.slackApi.callsWith(workspace.token, 'files.download');

    // Built per test: `ada` is created in beforeEach.
    const csv = () => [
      HEADER,
      row(ada.email, '2025-09-01', [
        '2026-03-02',
        '2026-03-06',
        'annual_leave',
        'approved',
      ]),
    ];

    it('ignores a file shared by a member', async () => {
      const reply = await share(ada, 'user-vacations.csv', csv().join('\n'));

      expect(reply).toContain('Only user with role Admin');
      expect(downloads()).toEqual([]);
      expect(await vacationsOf(ada)).toEqual([]);
    });

    it('ignores a file shared by a deactivated admin', async () => {
      await t.db.from('users').update({ is_active: false }).eq('id', admin.id);

      const reply = await share(admin, 'user-vacations.csv', csv().join('\n'));

      expect(reply).toBeUndefined();
      expect(downloads()).toEqual([]);
      expect(await vacationsOf(ada)).toEqual([]);
    });

    it('does not download a file it does not import', async () => {
      const reply = await share(admin, 'notes.txt', 'hello');

      expect(reply).toContain('Unknown file type');
      expect(downloads()).toEqual([]);
    });

    it('refuses a file over 1 MB without downloading it', async () => {
      const reply = await share(
        admin,
        'user-vacations.csv',
        csv().join('\n'),
        2 * 1024 * 1024,
      );

      expect(reply).toContain('larger than 1 MB');
      expect(downloads()).toEqual([]);
      expect(await vacationsOf(ada)).toEqual([]);
    });
  });

  // BUG: the import deletes the user's vacations before it inserts the new
  // ones, outside a transaction (vacation-requests.service.ts,
  // replaceUserVacations). A row the database refuses (here one that ends
  // before it starts, which the parser lets through) leaves the user with no
  // vacations at all.
  it.failing(
    "keeps the user's vacations when the new ones cannot be saved",
    async () => {
      await workspace.addVacationRequest(ada, {
        start_date: '2026-01-05',
        end_date: '2026-01-09',
      });

      await importCsv(
        row(ada.email, '2025-09-01', [
          '2026-03-06',
          '2026-03-02',
          'annual_leave',
          'approved',
        ]),
      );

      expect(await vacationsOf(ada)).toEqual([
        expect.objectContaining({ start_date: '2026-01-05' }),
      ]);
    },
  );
});
