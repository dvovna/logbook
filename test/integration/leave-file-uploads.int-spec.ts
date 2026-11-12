import UserRole from '@common/enums/user-role.enum';
import { Tables } from '@common/types/database.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { LeaveFileKind } from 'src/leave-file/enums/leave-file-kind.enum';
import { LeaveFileUploadsService } from 'src/leave-file/services/leave-file-uploads.service';
import {
  ILeaveBalanceRow,
  ILeaveHistoryRow,
} from 'src/leave-file/types/leave-file-row.interface';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';

// The domain side of a leave file, without Slack: what receive keeps and what
// Apply writes. Today is Wednesday 2026-06-17 (TEST_NOW).
describe('Leave file uploads', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let uploads: LeaveFileUploadsService;
  let hr: Tables<'users'>;
  let anna: Tables<'users'>;
  let team: Tables<'teams'>;

  const asUser = (user: Tables<'users'>) => user as unknown as IUserViewModel;

  beforeAll(async () => {
    t = await createTestApp();
    uploads = t.app.get(LeaveFileUploadsService);
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    hr = await workspace.addUser({ role: UserRole.HR });
    const policy = await workspace.addVacationPolicy({
      vacation_days: 26,
      working_days: 20,
      carryover_days: 5,
      bonus_days: 3,
    });
    team = await workspace.addTeam({ vacation_policy_id: policy.id });
    anna = await workspace.addUser({
      team_id: team.id,
      created_at: '2026-01-01T09:00:00Z',
    });
    await t.db
      .insertInto('holidays')
      .values({
        slack_team_id: workspace.id,
        vacation_policy_id: policy.id,
        name: 'Holiday',
        date: '2026-03-04',
        year: 2026,
        created_by: hr.id,
      })
      .execute();
  });

  const historyRow = (
    row: number,
    fields: Partial<ILeaveHistoryRow>,
  ): ILeaveHistoryRow => ({
    row,
    name: '',
    email: anna.email,
    leaveType: 'Annual leave',
    from: '',
    to: '',
    comment: '',
    ...fields,
  });

  const historyFile = (rows: ILeaveHistoryRow[]) => ({
    kind: LeaveFileKind.History as const,
    rows,
  });

  const balancesFile = (rows: ILeaveBalanceRow[]) => ({
    kind: LeaveFileKind.Balances as const,
    rows,
  });

  const uploadsOf = async () =>
    Object.fromEntries(
      (await workspace.rows('leave_file_uploads')).map((row) => [
        row.id,
        row.status,
      ]),
    );

  describe('a history file', () => {
    const rows = () => [
      historyRow(2, {
        email: ` ${anna.email.toUpperCase()} `,
        from: '2026-03-02',
        to: '2026-03-06',
        comment: 'Agreed by email',
      }),
      historyRow(3, {
        leaveType: 'Sick leave',
        from: '06.07.2026',
        to: '07.07.2026',
      }),
    ];

    it('adds its leaves as approved, in the person’s team, with nobody asked or told, once', async () => {
      const since = t.slackApi.mark();
      const { upload, preview } = await uploads.receive(
        historyFile(rows()),
        'leave-history.csv',
        asUser(hr),
      );

      expect(preview.plan).toMatchObject({ add: [{}, {}], unusable: [] });
      expect(await workspace.rows('vacation_requests')).toEqual([]);
      expect(await workspace.row('leave_file_uploads', upload.id)).toEqual(
        expect.objectContaining({
          kind: 'history',
          status: 'previewed',
          file_name: 'leave-history.csv',
          uploaded_by: hr.id,
          rows: rows(),
          plan_digest: upload.plan_digest,
        }),
      );

      const result = await uploads.apply(
        upload.id,
        upload.plan_digest,
        asUser(hr),
      );
      await t.idle();

      expect(result.kind).toBe('applied');
      const requests = (await workspace.rows('vacation_requests')).sort(
        (a, b) => a.start_date.localeCompare(b.start_date),
      );
      expect(
        requests.map((request) => ({
          user_id: request.user_id,
          team_id: request.team_id,
          type: request.type,
          status: request.status,
          start_date: request.start_date,
          end_date: request.end_date,
          days: request.days,
          working_days: request.working_days,
          user_comment: request.user_comment,
          leave_file_upload_id: request.leave_file_upload_id,
          created_by: request.created_by,
          updated_by: request.updated_by,
        })),
      ).toEqual([
        {
          user_id: anna.id,
          team_id: team.id,
          type: 'annual_leave',
          status: 'approved',
          start_date: '2026-03-02',
          end_date: '2026-03-06',
          days: 5,
          // March 4 is a holiday of the team's policy.
          working_days: 4,
          user_comment: 'Agreed by email',
          leave_file_upload_id: upload.id,
          created_by: hr.id,
          updated_by: hr.id,
        },
        {
          user_id: anna.id,
          team_id: team.id,
          type: 'sick_leave',
          status: 'approved',
          start_date: '2026-07-06',
          end_date: '2026-07-07',
          days: 2,
          working_days: 2,
          user_comment: null,
          leave_file_upload_id: upload.id,
          created_by: hr.id,
          updated_by: hr.id,
        },
      ]);
      expect(await workspace.rows('request_workflow_steps')).toEqual([]);
      expect(t.slackApi.calls.slice(since)).toEqual([]);

      const applied = await workspace.row('leave_file_uploads', upload.id);
      expect(applied.status).toBe('applied');
      expect(applied.undo).toEqual({
        kind: 'history',
        requests: expect.arrayContaining(
          requests.map(({ id, updated_at }) => ({ id, updatedAt: updated_at })),
        ),
      });

      await expect(
        uploads.apply(upload.id, upload.plan_digest, asUser(hr)),
      ).resolves.toMatchObject({ kind: 'closed', status: 'applied' });
      expect(await workspace.rows('vacation_requests')).toHaveLength(2);
    });

    it('shows a new preview instead when the workspace changed since, and applies that one', async () => {
      const { upload } = await uploads.receive(
        historyFile(rows()),
        'leave-history.csv',
        asUser(hr),
      );
      const made = await workspace.addVacationRequest(anna, {
        start_date: '2026-07-07',
        end_date: '2026-07-08',
        status: 'pending',
      });

      const changed = await uploads.apply(
        upload.id,
        upload.plan_digest,
        asUser(hr),
      );

      expect(changed.kind).toBe('changed');
      expect(changed.kind === 'changed' && changed.preview.plan).toMatchObject({
        add: [{ row: 2 }],
        unusable: [{ row: 3 }],
      });
      expect(await workspace.rows('vacation_requests')).toEqual([made]);
      const newDigest = changed.upload.plan_digest;
      expect(
        (await workspace.row('leave_file_uploads', upload.id)).plan_digest,
      ).toBe(newDigest);

      await expect(
        uploads.apply(upload.id, newDigest, asUser(hr)),
      ).resolves.toMatchObject({ kind: 'applied' });
      expect(await workspace.rows('vacation_requests')).toHaveLength(2);
    });

    it('applies nothing when everything in the file is in Logbook already', async () => {
      await workspace.addVacationRequest(anna, {
        start_date: '2026-03-02',
        end_date: '2026-03-06',
      });
      const { upload } = await uploads.receive(
        historyFile([rows()[0]]),
        'leave-history.csv',
        asUser(hr),
      );

      await expect(
        uploads.apply(upload.id, upload.plan_digest, asUser(hr)),
      ).resolves.toMatchObject({ kind: 'nothing' });
      expect(await uploadsOf()).toEqual({ [upload.id]: 'previewed' });
      expect(await workspace.rows('vacation_requests')).toHaveLength(1);
      await expect(uploads.hasApplied(workspace.id)).resolves.toBe(false);
    });

    it('says where an imported leave came from', async () => {
      const { upload } = await uploads.receive(
        historyFile(rows()),
        'leave-history.csv',
        asUser(hr),
      );

      await expect(
        uploads.findImport(upload.id, hr.id, workspace.id),
      ).resolves.toBe(null);

      const result = await uploads.apply(
        upload.id,
        upload.plan_digest,
        asUser(hr),
      );

      await expect(
        uploads.findImport(upload.id, hr.id, workspace.id),
      ).resolves.toEqual({
        fileName: 'leave-history.csv',
        appliedBy: expect.objectContaining({ id: hr.id }),
        appliedAt: result.upload.applied_at,
      });
      await expect(uploads.hasApplied(workspace.id)).resolves.toBe(true);

      const other = await t.createWorkspace();
      await expect(
        uploads.findImport(upload.id, hr.id, other.id),
      ).resolves.toBe(null);
    });
  });

  describe('a balances file', () => {
    it("sets the balances and contract starts, and keeps each person's earlier balance for Undo", async () => {
      const [earlierUpload] = await t.db
        .insertInto('leave_file_uploads')
        .values({
          slack_team_id: workspace.id,
          uploaded_by: hr.id,
          kind: 'balances',
          file_name: 'leave-balances.csv',
          rows: JSON.stringify([]),
          plan_digest: 'digest',
          status: 'applied',
        })
        .returningAll()
        .execute();
      const [earlier] = await t.db
        .insertInto('leave_balances')
        .values({
          slack_team_id: workspace.id,
          user_id: anna.id,
          balance_on: '2026-05-01',
          days_left: 3,
          upload_id: earlierUpload.id,
          set_by: hr.id,
        })
        .returningAll()
        .execute();
      const ben = await workspace.addUser({
        contract_start_date: '2020-01-01',
      });

      const { upload } = await uploads.receive(
        balancesFile([
          {
            row: 2,
            name: '',
            email: anna.email,
            contractStart: '2021-04-15',
            balanceOn: '2026-06-17',
            daysLeft: '12',
            workingDaysLeft: '',
            bonusDaysLeft: '1',
          },
          // A contract start only.
          {
            row: 3,
            name: '',
            email: ben.email,
            contractStart: '2020-02-01',
            balanceOn: '',
            daysLeft: '',
            workingDaysLeft: '',
            bonusDaysLeft: '',
          },
        ]),
        'leave-balances.csv',
        asUser(hr),
      );

      expect(
        (await workspace.rows('leave_balances')).map((row) => row.id),
      ).toEqual([earlier.id]);

      const result = await uploads.apply(
        upload.id,
        upload.plan_digest,
        asUser(hr),
      );

      expect(result.kind).toBe('applied');
      const [balance] = await workspace.rows('leave_balances');
      expect(balance).toMatchObject({
        user_id: anna.id,
        balance_on: '2026-06-17',
        days_left: 12,
        working_days_left: null,
        bonus_days_left: 1,
        upload_id: upload.id,
        set_by: hr.id,
      });
      expect((await workspace.row('users', anna.id)).contract_start_date).toBe(
        '2021-04-15',
      );
      expect((await workspace.row('users', ben.id)).contract_start_date).toBe(
        '2020-02-01',
      );
      expect(
        (await workspace.row('leave_file_uploads', upload.id)).undo,
      ).toEqual({
        kind: 'balances',
        balances: [
          {
            userId: anna.id,
            before: {
              balanceOn: '2026-05-01',
              daysLeft: 3,
              workingDaysLeft: null,
              bonusDaysLeft: null,
              uploadId: earlierUpload.id,
              setBy: hr.id,
              updatedAt: earlier.updated_at,
            },
            updatedAt: balance.updated_at,
          },
        ],
        contractStarts: expect.arrayContaining([
          { userId: anna.id, before: null, after: '2021-04-15' },
          { userId: ben.id, before: '2020-01-01', after: '2020-02-01' },
        ]),
      });
    });
  });

  describe('undoing a file', () => {
    const applyHistory = async (rows: ILeaveHistoryRow[]) => {
      const { upload } = await uploads.receive(
        historyFile(rows),
        'leave-history.csv',
        asUser(hr),
      );

      await uploads.apply(upload.id, upload.plan_digest, asUser(hr));

      return upload;
    };

    // The test clock ticks in steps, so an edit right after Apply could
    // carry the same time.
    const minutesLater = () => new Date(Date.now() + 60_000).toISOString();

    const leave = (row: number, from: string, to: string) =>
      historyRow(row, { from, to });

    it('deletes the leaves as the upload left them and keeps one HR edited since, naming it', async () => {
      const upload = await applyHistory([
        leave(2, '2026-03-02', '2026-03-06'),
        leave(3, '2026-07-06', '2026-07-07'),
      ]);
      const [edited] = (await workspace.rows('vacation_requests')).sort(
        (a, b) => a.start_date.localeCompare(b.start_date),
      );

      await t.db
        .updateTable('vacation_requests')
        .set({ user_comment: 'Moved', updated_at: minutesLater() })
        .where('id', '=', edited.id)
        .execute();

      const result = await uploads.undo(upload.id, asUser(hr));

      expect(result).toMatchObject({
        kind: 'undone',
        restored: 1,
        kept: [`${anna.name || anna.email}'s annual leave 2–6 Mar 2026`],
      });
      expect(
        (await workspace.rows('vacation_requests')).map((r) => r.id),
      ).toEqual([edited.id]);
      expect(await uploadsOf()).toEqual({ [upload.id]: 'undone' });
      await expect(uploads.undo(upload.id, asUser(hr))).resolves.toEqual({
        kind: 'closed',
        reason: 'it was already undone',
      });
    });

    it('neither restores nor keeps a leave deleted since', async () => {
      const upload = await applyHistory([leave(2, '2026-03-02', '2026-03-06')]);

      await t.db
        .deleteFrom('vacation_requests')
        .where('slack_team_id', '=', workspace.id)
        .execute();

      await expect(uploads.undo(upload.id, asUser(hr))).resolves.toMatchObject({
        kind: 'undone',
        restored: 0,
        kept: [],
      });
    });

    it('undoes an older upload after a newer one, leaving the newer one’s leaves', async () => {
      const older = await applyHistory([leave(2, '2026-03-02', '2026-03-06')]);
      const newer = await applyHistory([leave(2, '2026-07-06', '2026-07-07')]);

      await expect(uploads.undo(older.id, asUser(hr))).resolves.toMatchObject({
        kind: 'undone',
        restored: 1,
        kept: [],
      });
      expect(
        (await workspace.rows('vacation_requests')).map((r) => ({
          start: r.start_date,
          upload: r.leave_file_upload_id,
        })),
      ).toEqual([{ start: '2026-07-06', upload: newer.id }]);
    });

    it('closes an upload applied more than 7 days ago and an ID of another workspace', async () => {
      const upload = await applyHistory([leave(2, '2026-03-02', '2026-03-06')]);

      await t.db
        .updateTable('leave_file_uploads')
        .set({
          applied_at: new Date(Date.now() - 8 * 86_400_000).toISOString(),
        })
        .execute();

      await expect(uploads.undo(upload.id, asUser(hr))).resolves.toEqual({
        kind: 'closed',
        reason: "it's been more than 7 days",
      });
      expect(await workspace.rows('vacation_requests')).toHaveLength(1);

      const other = await t.createWorkspace();
      const stranger = await other.addUser({ role: UserRole.HR });

      await expect(uploads.undo(upload.id, asUser(stranger))).rejects.toThrow(
        'This preview is no longer open.',
      );
    });

    it('puts back the earlier balance and contract start, and keeps what changed since', async () => {
      const [earlierUpload] = await t.db
        .insertInto('leave_file_uploads')
        .values({
          slack_team_id: workspace.id,
          uploaded_by: hr.id,
          kind: 'balances',
          file_name: 'leave-balances.csv',
          rows: JSON.stringify([]),
          plan_digest: 'digest',
          status: 'applied',
        })
        .returningAll()
        .execute();
      const [earlier] = await t.db
        .insertInto('leave_balances')
        .values({
          slack_team_id: workspace.id,
          user_id: anna.id,
          balance_on: '2026-05-01',
          days_left: 3,
          upload_id: earlierUpload.id,
          set_by: hr.id,
        })
        .returningAll()
        .execute();
      const ben = await workspace.addUser({
        name: 'Ben Brown',
        contract_start_date: '2020-01-01',
      });
      const cara = await workspace.addUser({
        name: 'Cara Cole',
        team_id: team.id,
        created_at: '2026-01-01T09:00:00Z',
      });
      const row = (
        who: Tables<'users'>,
        fields: Partial<ILeaveBalanceRow>,
      ) => ({
        row: 2,
        name: '',
        email: who.email,
        contractStart: '',
        balanceOn: '',
        daysLeft: '',
        workingDaysLeft: '',
        bonusDaysLeft: '',
        ...fields,
      });
      const { upload } = await uploads.receive(
        balancesFile([
          row(anna, {
            contractStart: '2021-04-15',
            balanceOn: '2026-06-17',
            daysLeft: '12',
          }),
          row(ben, { contractStart: '2020-02-01' }),
          row(cara, { balanceOn: '2026-06-17', daysLeft: '7' }),
        ]),
        'leave-balances.csv',
        asUser(hr),
      );

      await uploads.apply(upload.id, upload.plan_digest, asUser(hr));
      // Since the file: HR set Ben's contract start and Cara's balance again.
      await t.db
        .updateTable('users')
        .set({ contract_start_date: '2019-09-09' })
        .where('id', '=', ben.id)
        .execute();
      await t.db
        .updateTable('leave_balances')
        .set({ days_left: 8, updated_at: minutesLater() })
        .where('user_id', '=', cara.id)
        .execute();

      const result = await uploads.undo(upload.id, asUser(hr));

      expect(result).toMatchObject({
        kind: 'undone',
        // Anna's balance and contract start.
        restored: 2,
        kept: ["Cara Cole's balance", "Ben Brown's contract start"],
      });
      const balances = await workspace.rows('leave_balances');

      expect(
        balances
          .map(({ user_id, days_left, upload_id }) => ({
            user_id,
            days_left,
            upload_id,
          }))
          .sort((a, b) => a.days_left! - b.days_left!),
      ).toEqual([
        { user_id: anna.id, days_left: 3, upload_id: earlierUpload.id },
        { user_id: cara.id, days_left: 8, upload_id: upload.id },
      ]);
      expect(balances.find((b) => b.user_id === anna.id)).toMatchObject({
        balance_on: '2026-05-01',
        updated_at: earlier.updated_at,
      });
      expect((await workspace.row('users', anna.id)).contract_start_date).toBe(
        null,
      );
      expect((await workspace.row('users', ben.id)).contract_start_date).toBe(
        '2019-09-09',
      );
      expect(await uploadsOf()).toMatchObject({ [upload.id]: 'undone' });
    });
  });

  it('replaces only the open preview of the same kind', async () => {
    const receive = async (kind: LeaveFileKind) =>
      (
        await uploads.receive(
          kind === LeaveFileKind.History ? historyFile([]) : balancesFile([]),
          `${kind}.csv`,
          asUser(hr),
        )
      ).upload;

    const history = await receive(LeaveFileKind.History);
    const balances = await receive(LeaveFileKind.Balances);
    const newerHistory = await receive(LeaveFileKind.History);

    expect(await uploadsOf()).toEqual({
      [history.id]: 'superseded',
      [balances.id]: 'previewed',
      [newerHistory.id]: 'previewed',
    });
    await expect(
      uploads.apply(history.id, history.plan_digest, asUser(hr)),
    ).resolves.toMatchObject({ kind: 'closed', status: 'superseded' });

    await uploads.cancel(balances.id, asUser(hr));

    expect((await uploadsOf())[balances.id]).toBe('canceled');
    await expect(uploads.cancel(balances.id, asUser(hr))).rejects.toThrow(
      'This preview is no longer open.',
    );
  });

  it("finds no upload of another workspace's", async () => {
    const { upload } = await uploads.receive(
      historyFile([]),
      'leave-history.csv',
      asUser(hr),
    );
    const other = await t.createWorkspace();
    const stranger = await other.addUser({ role: UserRole.HR });

    await expect(
      uploads.apply(upload.id, upload.plan_digest, asUser(stranger)),
    ).rejects.toThrow('This preview is no longer open.');
    await expect(uploads.cancel(upload.id, asUser(stranger))).rejects.toThrow(
      'This preview is no longer open.',
    );
    expect(await uploadsOf()).toEqual({ [upload.id]: 'previewed' });
  });
});
