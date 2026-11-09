import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { UsersService } from '@modules/users/services/users.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { View } from '@slack/types/dist/views';
import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { acknowledged } from './support/slack-test-client';
import { openAppHomeTab } from './support/app-home';
import { sectionTexts } from './support/tab-readers';

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

    // The summary, then the problems, if any.
    return reply
      ? sectionTexts(reply as unknown as View).join('\n')
      : undefined;
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
      '✅ Imported `user-vacations.csv`: Created 0 · Updated 1 · Skipped 0',
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

  // The old vacations out and the new ones in are one transaction: when the
  // database refuses one of them, the user keeps what they had.
  it('keeps the vacations when the database refuses a new one', async () => {
    await workspace.addVacationRequest(ada, {
      start_date: '2026-01-05',
      end_date: '2026-01-09',
    });
    const before = await vacationsOf(ada);
    const vacations = t.app.get(VacationRequestsService);
    const vacation = {
      userId: ada.id,
      teamId: ada.team_id,
      startDate: new Date('2026-03-02'),
      endDate: new Date('2026-03-06'),
      type: VacationType.AnnualLeave,
      status: VacationRequestStatus.Approved,
    };
    const asAdmin = await t.app
      .get(UsersService)
      .findBySlackId(admin.slack_id, workspace.id);
    const adaUser = await t.app
      .get(UsersService)
      .findBySlackId(ada.slack_id, workspace.id);

    await expect(
      vacations.replaceUserVacations(
        adaUser!,
        [vacation, { ...vacation, type: 'no_such_type' as VacationType }],
        asAdmin!,
      ),
    ).rejects.toThrow('[vacation_requests] createMany error: new row');

    expect(await vacationsOf(ada)).toEqual(before);
  });

  it('shows the imported vacations in the balance at once', async () => {
    await t.db
      .from('users')
      .update({ contract_start_date: '2025-09-01' })
      .eq('id', ada.id);
    const annualLeave = async () =>
      sectionTexts(await openAppHomeTab(t, workspace, ada)).filter((text) =>
        text.startsWith('Annual leave'),
      );
    expect(await annualLeave()).toEqual([
      'Annual leave: *28 available* / 28 total',
    ]);

    await importCsv(
      row(ada.email, '2025-09-01', [
        '2026-03-02',
        '2026-03-06',
        'annual_leave',
        'approved',
      ]),
    );

    // March 4 is a holiday of Ada's policy.
    expect(await annualLeave()).toEqual([
      'Annual leave: *23 available* / 28 total (*5* used, *4* working)',
    ]);
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

    expect(reply).toContain('`user-vacations.csv` was not imported');
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
      [
        '⚠️ Imported `user-vacations.csv` with problems: Created 0 · Updated 1 · Skipped 1',
        '*1 problem:*\n• User not found: ghost@example.test',
      ].join('\n'),
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

  // A database refusal while saving the new vacations leaves the old ones
  // too (unit-tested in vacation-requests.service.spec.ts).
  it('changes nothing for a vacation that ends before it starts', async () => {
    await workspace.addVacationRequest(ada, {
      start_date: '2026-01-05',
      end_date: '2026-01-09',
    });

    const reply = await importCsv(
      row(ada.email, '2025-09-01', [
        '2026-03-06',
        '2026-03-02',
        'annual_leave',
        'approved',
      ]),
    );

    expect(reply).toContain(
      'Vacation 1 for ada@example.test is invalid: it ends before it starts.',
    );
    expect(await vacationsOf(ada)).toEqual([
      expect.objectContaining({ start_date: '2026-01-05' }),
    ]);
    expect(
      (await workspace.row('users', ada.id)).contract_start_date,
    ).toBeNull();
  });
});
