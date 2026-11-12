import UserRole from '@common/enums/user-role.enum';
import { Tables, TablesInsert } from '@common/types/database.types';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import { toStoredBalance } from '@modules/vacation-requests/utils/leave-balance.utils';
import { sectionTexts, modalError } from './support/tab-readers';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import {
  approvalMessageTo,
  requestVacation,
  submitVacationRequest,
} from './support/vacation-flows';
import { navigate, openAppHomeTab, openModalFrom } from './support/app-home';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';

// Today is Wednesday 2026-06-17 (TEST_NOW). Without a contract start date the
// vacation year is the calendar year 2026.
describe('A balance from a file', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let hr: Tables<'users'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  beforeEach(async () => {
    workspace = await t.createWorkspace();
    hr = await workspace.addUser({ role: UserRole.HR });
  });

  const setUp = async (memberFields: Partial<TablesInsert<'users'>> = {}) => {
    const policy = await workspace.addVacationPolicy({
      vacation_days: 26,
      working_days: 20,
      carryover_days: 5,
      bonus_days: 3,
    });
    const team = await workspace.addTeam({ vacation_policy_id: policy.id });
    member = await workspace.addUser({
      team_id: team.id,
      role: UserRole.Member,
      created_at: '2026-01-01T09:00:00Z',
      ...memberFields,
    });
    // 10 days, 8 working.
    await workspace.addVacationRequest(member, {
      start_date: '2026-03-02',
      end_date: '2026-03-11',
      days: 10,
      working_days: 8,
    });
  };

  const addUpload = async () =>
    t.db
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
      .executeTakeFirstOrThrow();

  const addBalance = async (
    user: Tables<'users'>,
    fields: Partial<TablesInsert<'leave_balances'>>,
  ) =>
    t.db
      .insertInto('leave_balances')
      .values({
        slack_team_id: workspace.id,
        user_id: user.id,
        balance_on: '2026-06-17',
        set_by: hr.id,
        ...fields,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

  const hintOf = (view: { blocks?: unknown[] }) =>
    (view.blocks as { block_id?: string; hint?: { text: string } }[]).find(
      ({ block_id }) => block_id === 'carryover_days_block',
    )?.hint?.text;

  const notEnough = (requested: number, available: number) => ({
    response_action: 'errors',
    errors: {
      end_date_block: `Not enough vacation days. Requested: ${requested}, available: ${available}`,
    },
  });

  describe('requesting', () => {
    it('refuses a request above the file balance', async () => {
      await setUp();
      await addBalance(member, { days_left: 12 });

      // Monday to Saturday of the next week: 13 days, 10 working.
      const response = await submitVacationRequest(t, workspace, member, {
        start: '2026-07-06',
        end: '2026-07-18',
      });

      expect(response).toEqual(notEnough(13, 12));
      expect(
        (await workspace.rows('vacation_requests')).map(
          ({ start_date }) => start_date,
        ),
      ).toEqual(['2026-03-02']);
    });

    it('takes a request from the balance date on from it', async () => {
      await setUp();
      await addBalance(member, { days_left: 12 });
      await workspace.addVacationRequest(member, {
        start_date: '2026-07-06',
        end_date: '2026-07-10',
        days: 5,
        working_days: 5,
      });

      const response = await submitVacationRequest(t, workspace, member, {
        start: '2026-08-03',
        end: '2026-08-10',
      });

      expect(response).toEqual(notEnough(8, 7));
    });

    it("ignores the profile's carryover in the year of a file balance", async () => {
      await setUp({ carryover_days: 5 });
      await addBalance(member, { days_left: 12 });

      const response = await submitVacationRequest(t, workspace, member, {
        start: '2026-07-06',
        end: '2026-07-18',
      });

      expect(response).toEqual(notEnough(13, 12));
    });

    it('takes only the days from the balance date on of a request HR records across it', async () => {
      await setUp();
      await addBalance(member, { days_left: 3 });
      const form = await openModalFrom(
        t,
        workspace,
        hr,
        await openAppHomeTab(t, workspace, hr, [
          NavigationActionId.TimeOff,
          NavigationActionId.AllRequests,
        ]),
        VacationRequestsTabViewActionId.CreateRequest,
      );

      // Monday to Friday of this week: 3 days from Wednesday, June 17, on.
      const response = await t.slack
        .submitView(workspace, hr, form, {
          [VacationRequestsTabViewActionId.UserField]: member.id,
          status: VacationRequestStatus.Approved,
          start_date: '2026-06-15',
          end_date: '2026-06-19',
          type_option: VacationType.AnnualLeave,
        })
        .expect(200);

      expect(response.body).toEqual({ response_action: 'clear' });
      expect(
        (await workspace.rows('vacation_requests'))
          .map(({ start_date }) => start_date)
          .sort(),
      ).toEqual(['2026-03-02', '2026-06-15']);
    });

    it("tells the approver the balance after it of a total with the file's correction", async () => {
      await setUp();
      const manager = await workspace.addUser({ role: UserRole.Manager });
      await t.db
        .updateTable('teams')
        .set({ manager_approvers: [manager.slack_id] })
        .where('id', '=', member.team_id!)
        .execute();
      // Logbook counts 16 left: a correction of +4.
      await addBalance(member, { days_left: 20 });

      await requestVacation(t, workspace, member, {
        start: '2026-07-06',
        end: '2026-07-10',
      });

      expect(
        (
          (await approvalMessageTo(t, workspace, manager)).blocks as {
            type: string;
            elements?: { text: string }[];
          }[]
        )
          .filter((block) => block.type === 'context')
          .map((block) => block.elements![0].text),
      ).toEqual(['Balance after: 15 of 30 days']);
    });

    it('takes a request within the file balance', async () => {
      await setUp();
      await addBalance(member, { days_left: 12 });

      const response = await submitVacationRequest(t, workspace, member, {
        start: '2026-07-06',
        end: '2026-07-17',
      });

      expect(response).toEqual({ response_action: 'clear' });
    });
  });

  describe('showing', () => {
    const FILE_LINE =
      'Set from a file: 12 days, 14 working days, 2 bonus days left on 17 Jun 2026.';

    const contextTexts = (view: { blocks?: unknown[] }) =>
      (view.blocks as { type: string; elements: { text: string }[] }[])
        .filter((block) => block.type === 'context')
        .flatMap((block) => block.elements.map(({ text }) => text));

    const addFullBalance = () =>
      addBalance(member, {
        days_left: 12,
        working_days_left: 14,
        bonus_days_left: 2,
      });

    it('shows the correction and the file line on Home', async () => {
      await setUp();
      await addFullBalance();

      const home = await openAppHomeTab(t, workspace, member);

      expect(
        sectionTexts(home).filter((text) => /^(Annual|Bonus)/.test(text)),
      ).toEqual([
        'Annual leave: *12 available* / 26 total (*10* used, *8* working, *-4* correction, *+2* working correction)',
        'Bonus days: *2 available* / 3 total (*-1* correction)',
      ]);
      expect(contextTexts(home)).toEqual([FILE_LINE]);
    });

    it('names only the units the file gave', async () => {
      await setUp();
      await addBalance(member, { days_left: 12 });

      const home = await openAppHomeTab(t, workspace, member);

      expect(contextTexts(home)).toEqual([
        'Set from a file: 12 days left on 17 Jun 2026.',
      ]);
      expect(
        sectionTexts(home).filter((text) => text.startsWith('Annual')),
      ).toEqual([
        'Annual leave: *12 available* / 26 total (*10* used, *8* working, *-4* correction)',
      ]);
    });

    it('shows nothing without a file balance', async () => {
      await setUp();

      const home = await openAppHomeTab(t, workspace, member);

      expect(contextTexts(home)).toEqual([]);
      expect(
        sectionTexts(home).filter((text) => text.startsWith('Annual')),
      ).toEqual([
        'Annual leave: *16 available* / 26 total (*10* used, *8* working)',
      ]);
    });

    it('shows nothing of a balance from an earlier year', async () => {
      await setUp();
      await addBalance(member, { balance_on: '2025-12-01', days_left: 12 });

      expect(contextTexts(await openAppHomeTab(t, workspace, member))).toEqual(
        [],
      );
    });

    it('shows the correction and the file line in the usage modal', async () => {
      await setUp();
      await addFullBalance();
      const usage = await openModalFrom(
        t,
        workspace,
        hr,
        await openAppHomeTab(t, workspace, hr, [NavigationActionId.People]),
        UsersTabViewActionId.ManageUserMenu,
        `${UsersTabViewActionId.ViewVacationUsage}:${member.id}`,
      );

      expect(sectionTexts(usage)).toEqual([
        expect.stringMatching(
          /^\*.*Annual leave\*\n\nUsed: \*10\* days \(\*8\* working\)\nAvailable: \*12\* \(\*14\* working\) \/ Limit: \*26\* days \(\*-4\* correction, \*\+2\* working correction\)$/,
        ),
        expect.stringMatching(
          /^\*.*Bonus days\*\n\nUsed: \*0\* days\nAvailable: \*2\* \/ Limit: \*3\* days \(\*-1\* correction\)$/,
        ),
      ]);
      expect(contextTexts(usage)).toEqual([FILE_LINE]);
    });

    it('says in the edit form that the file replaces the carryover', async () => {
      await setUp({ carryover_days: 2 });
      await addFullBalance();
      const form = await openModalFrom(
        t,
        workspace,
        hr,
        await openAppHomeTab(t, workspace, hr, [NavigationActionId.People]),
        UsersTabViewActionId.ManageUserMenu,
        `${UsersTabViewActionId.EditUser}:${member.id}`,
      );

      expect(hintOf(form)).toBe(
        "This year's balance comes from a file (12 days left on 17 Jun 2026), so carryover here changes nothing.",
      );
    });

    const openEditForm = async () =>
      hintOf(
        await openModalFrom(
          t,
          workspace,
          hr,
          await openAppHomeTab(t, workspace, hr, [NavigationActionId.People]),
          UsersTabViewActionId.ManageUserMenu,
          `${UsersTabViewActionId.EditUser}:${member.id}`,
        ),
      );

    it('keeps the usual carryover hint without days left in the file', async () => {
      await setUp();
      await addBalance(member, { working_days_left: 14 });

      expect(await openEditForm()).toBe(
        "Days left from before they joined, for the vacation year from 1 Jan 2026. Each later year carries over what is left on its own, up to the policy's limit.",
      );
    });

    it('says in the edit form when the balance from a file falls in the year before', async () => {
      await setUp({ contract_start_date: '2020-06-15' });
      await addBalance(member, { balance_on: '2026-06-10', days_left: 12 });

      expect(await openEditForm()).toBe(
        'The balance from a file (12 days left on 10 Jun 2026) falls in the vacation year before this one, so this year starts with what it carries over.',
      );

      await t.db
        .updateTable('leave_balances')
        .set({ days_left: null, working_days_left: 9, bonus_days_left: 1 })
        .where('user_id', '=', member.id)
        .execute();

      expect(await openEditForm()).toBe(
        'The balance from a file (9 working days, 1 bonus day left on 10 Jun 2026) falls in the vacation year before this one, so this year starts with what it carries over.',
      );
    });

    it('says so of a balance from the calendar year before, before the person joined', async () => {
      await setUp();
      await addBalance(member, { balance_on: '2025-12-01', days_left: 12 });

      expect(await openEditForm()).toBe(
        'The balance from a file (12 days left on 1 Dec 2025) falls in the vacation year before this one, so this year starts with what it carries over.',
      );
    });

    it('reads the balance from a file once for each screen that names it', async () => {
      await setUp();
      await addFullBalance();
      const [home, people] = [
        await openAppHomeTab(t, workspace, member),
        await openAppHomeTab(t, workspace, hr, [NavigationActionId.People]),
      ];
      const balanceReads = async (open: () => Promise<unknown>) => {
        await t.idle();
        const since = t.sql.mark();
        await open();
        await t.idle();

        return t.sql
          .statements(since)
          .filter(({ text }) => text.includes('from "leave_balances"')).length;
      };

      expect(
        await balanceReads(() =>
          navigate(t, workspace, member, home, NavigationActionId.Home),
        ),
      ).toBe(1);
      expect(
        await balanceReads(() =>
          navigate(t, workspace, member, home, NavigationActionId.TimeOff),
        ),
      ).toBe(1);
      expect(
        await balanceReads(() =>
          openModalFrom(
            t,
            workspace,
            hr,
            people,
            UsersTabViewActionId.ManageUserMenu,
            `${UsersTabViewActionId.ViewVacationUsage}:${member.id}`,
          ),
        ),
      ).toBe(1);
    });

    it('shows the file line on Time off and only with a file balance', async () => {
      await setUp();

      expect(
        contextTexts(
          await openAppHomeTab(t, workspace, member, [
            NavigationActionId.TimeOff,
          ]),
        ),
      ).not.toContain(FILE_LINE);

      await addFullBalance();
      const history = await openAppHomeTab(t, workspace, member, [
        NavigationActionId.TimeOff,
      ]);

      expect(contextTexts(history)[0]).toBe(FILE_LINE);
    });
  });

  describe('LeaveBalancesService', () => {
    let balances: LeaveBalancesService;

    beforeAll(() => {
      balances = t.app.get(LeaveBalancesService);
    });

    const asUser = (user: Tables<'users'>) => user as unknown as IUserViewModel;

    const twelveOn = (userId: string, daysLeft = 12) => ({
      userId,
      balanceOn: '2026-06-17',
      daysLeft,
      workingDaysLeft: null,
      bonusDaysLeft: null,
    });

    const valuesOf = async () =>
      (await workspace.rows('leave_balances'))
        .map((row) => ({
          user_id: row.user_id,
          balance_on: row.balance_on,
          days_left: row.days_left,
          working_days_left: row.working_days_left,
          bonus_days_left: row.bonus_days_left,
          upload_id: row.upload_id,
        }))
        .sort((a, b) => a.user_id.localeCompare(b.user_id));

    it("sets balances and replaces a person's earlier one whole", async () => {
      const [anna, ben] = await Promise.all([
        workspace.addUser(),
        workspace.addUser(),
      ]);
      const upload = await addUpload();
      await addBalance(anna, {
        balance_on: '2026-06-01',
        days_left: 3,
        working_days_left: 2,
      });

      const set = await balances.setMany(
        [
          {
            userId: anna.id,
            balanceOn: '2026-06-17',
            daysLeft: 12.5,
            workingDaysLeft: null,
            bonusDaysLeft: 1,
          },
          {
            userId: ben.id,
            balanceOn: '2026-06-17',
            daysLeft: -2,
            workingDaysLeft: null,
            bonusDaysLeft: null,
          },
        ],
        upload.id,
        asUser(hr),
      );

      expect(set.map(({ user_id }) => user_id).sort()).toEqual(
        [anna.id, ben.id].sort(),
      );
      expect(await valuesOf()).toEqual(
        [
          {
            user_id: anna.id,
            balance_on: '2026-06-17',
            days_left: 12.5,
            working_days_left: null,
            bonus_days_left: 1,
            upload_id: upload.id,
          },
          {
            user_id: ben.id,
            balance_on: '2026-06-17',
            days_left: -2,
            working_days_left: null,
            bonus_days_left: null,
            upload_id: upload.id,
          },
        ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
      );
      expect(await balances.findOfUser(anna.id, workspace.id)).toEqual(
        set.find(({ user_id }) => user_id === anna.id),
      );
      expect(
        (await balances.findOfUsers([anna.id, ben.id], workspace.id)).length,
      ).toBe(2);
    });

    it("sets no balance of another workspace's person and leaves its row alone", async () => {
      const other = await t.createWorkspace();
      const [kept, stranger] = await Promise.all([
        other.addUser(),
        other.addUser(),
      ]);
      const anna = await workspace.addUser();
      const theirs = await t.db
        .insertInto('leave_balances')
        .values({
          slack_team_id: other.id,
          user_id: kept.id,
          balance_on: '2026-06-01',
          days_left: 3,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const upload = await addUpload();

      const set = await balances.setMany(
        [twelveOn(kept.id), twelveOn(stranger.id), twelveOn(anna.id)],
        upload.id,
        asUser(hr),
      );

      expect(set.map(({ user_id }) => user_id)).toEqual([anna.id]);
      expect(await other.rows('leave_balances')).toEqual([theirs]);
      expect(
        (await workspace.rows('leave_balances')).map(({ user_id }) => user_id),
      ).toEqual([anna.id]);
    });

    it('restores the balance before an upload where it is still as the upload left it', async () => {
      const [anna, ben, carla] = await Promise.all([
        workspace.addUser(),
        workspace.addUser(),
        workspace.addUser(),
      ]);
      const upload = await addUpload();
      const annaBefore = await addBalance(anna, {
        balance_on: '2026-06-01',
        days_left: 3,
      });
      const set = await balances.setMany(
        [anna, ben, carla].map(({ id }) => twelveOn(id)),
        upload.id,
        asUser(hr),
      );
      const updatedAtOf = (userId: string) =>
        set.find(({ user_id }) => user_id === userId)!.updated_at;
      // Changed since the upload: kept.
      await t.db
        .updateTable('leave_balances')
        .set({ days_left: 9, updated_at: '2026-06-18T09:00:00Z' })
        .where('user_id', '=', carla.id)
        .execute();

      const restored = await balances.restoreMany(
        [
          {
            userId: anna.id,
            uploadId: upload.id,
            updatedAt: updatedAtOf(anna.id),
            before: toStoredBalance(annaBefore as ILeaveBalance),
          },
          {
            userId: ben.id,
            uploadId: upload.id,
            updatedAt: updatedAtOf(ben.id),
            before: null,
          },
          {
            userId: carla.id,
            uploadId: upload.id,
            updatedAt: updatedAtOf(carla.id),
            before: null,
          },
        ],
        workspace.id,
      );

      expect(restored.sort()).toEqual([anna.id, ben.id].sort());
      expect(await balances.findOfUser(anna.id, workspace.id)).toEqual(
        annaBefore,
      );
      expect(await valuesOf()).toEqual(
        [
          {
            user_id: anna.id,
            balance_on: '2026-06-01',
            days_left: 3,
            working_days_left: null,
            bonus_days_left: null,
            upload_id: null,
          },
          {
            user_id: carla.id,
            balance_on: '2026-06-17',
            days_left: 9,
            working_days_left: null,
            bonus_days_left: null,
            upload_id: upload.id,
          },
        ].sort((a, b) => a.user_id.localeCompare(b.user_id)),
      );
    });

    it("puts back the earlier upload's row whole, so that its own Undo still finds it", async () => {
      const anna = await workspace.addUser();
      const otherHr = await workspace.addUser({ role: UserRole.HR });
      const [first, second] = [await addUpload(), await addUpload()];
      const [afterFirst] = await balances.setMany(
        [twelveOn(anna.id, 10)],
        first.id,
        asUser(hr),
      );
      const [afterSecond] = await balances.setMany(
        [twelveOn(anna.id, 12)],
        second.id,
        asUser(otherHr),
      );

      expect(
        await balances.restoreMany(
          [
            {
              userId: anna.id,
              uploadId: second.id,
              updatedAt: afterSecond.updated_at,
              before: toStoredBalance(afterFirst),
            },
          ],
          workspace.id,
        ),
      ).toEqual([anna.id]);
      expect(await balances.findOfUser(anna.id, workspace.id)).toEqual(
        afterFirst,
      );

      expect(
        await balances.restoreMany(
          [
            {
              userId: anna.id,
              uploadId: first.id,
              updatedAt: afterFirst.updated_at,
              before: null,
            },
          ],
          workspace.id,
        ),
      ).toEqual([anna.id]);
      expect(await workspace.rows('leave_balances')).toEqual([]);
    });

    it("restores nothing of another workspace's", async () => {
      const other = await t.createWorkspace();
      const stranger = await other.addUser();
      const upload = await t.db
        .insertInto('leave_file_uploads')
        .values({
          slack_team_id: other.id,
          kind: 'balances',
          file_name: 'leave-balances.csv',
          rows: JSON.stringify([]),
          plan_digest: 'digest',
          status: 'applied',
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const row = await t.db
        .insertInto('leave_balances')
        .values({
          slack_team_id: other.id,
          user_id: stranger.id,
          balance_on: '2026-06-17',
          days_left: 12,
          upload_id: upload.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(
        await balances.restoreMany(
          [
            {
              userId: stranger.id,
              uploadId: upload.id,
              updatedAt: row.updated_at,
              before: null,
            },
            {
              userId: stranger.id,
              uploadId: upload.id,
              updatedAt: row.updated_at,
              before: {
                balanceOn: '2026-06-01',
                daysLeft: 1,
                workingDaysLeft: null,
                bonusDaysLeft: null,
                uploadId: null,
                setBy: null,
                updatedAt: '2026-06-01T09:00:00Z',
              },
            },
          ],
          workspace.id,
        ),
      ).toEqual([]);
      expect(await other.rows('leave_balances')).toEqual([row]);
    });
  });
});
