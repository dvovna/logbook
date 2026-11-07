import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables, TablesInsert } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { addDays, workWeek } from './support/dates';
import { openAppHomeTab } from './support/app-home';
import { modalError, sectionTexts } from './support/tab-readers';
import { submitVacationRequest } from './support/vacation-flows';

// Today is Wednesday 2026-06-17 (TEST_NOW). Without a contract start date the
// vacation year is the calendar year 2026.
describe('Vacation balance under a policy', () => {
  let t: ITestApp;
  let workspace: TestWorkspace;
  let policy: Tables<'vacation_policies'>;
  let team: Tables<'teams'>;
  let member: Tables<'users'>;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(() => t.close());

  const setUp = async (
    policyFields: Partial<TablesInsert<'vacation_policies'>>,
    memberFields: Partial<TablesInsert<'users'>> = {},
  ) => {
    policy = await workspace.addVacationPolicy(policyFields);
    team = await workspace.addTeam({ vacation_policy_id: policy.id });
    member = await workspace.addUser({
      team_id: team.id,
      role: UserRole.Member,
      ...memberFields,
    });
  };

  beforeEach(async () => {
    workspace = await t.createWorkspace();
  });

  const usageOnHome = async () =>
    sectionTexts(await openAppHomeTab(t, workspace, member)).filter(
      (text) =>
        text.startsWith('Annual leave') || text.startsWith('Bonus Days'),
    );

  const request = (type = VacationType.AnnualLeave, week = workWeek(1)) =>
    submitVacationRequest(t, workspace, member, { ...week, type });

  describe('on Home', () => {
    it('shows what is left of the policy, with carryover', async () => {
      await setUp(
        { vacation_days: 20, working_days: 15, bonus_days: 2 },
        { carryover_days: 3 },
      );
      await workspace.addVacationRequest(member, {
        start_date: '2026-03-02',
        end_date: '2026-03-08',
        days: 7,
        working_days: 5,
      });
      await workspace.addVacationRequest(member, {
        start_date: '2026-04-06',
        end_date: '2026-04-06',
        type: VacationType.BonusDay,
      });
      // Not counted: rejected, or last year.
      await workspace.addVacationRequest(member, {
        start_date: '2026-05-04',
        end_date: '2026-05-08',
        days: 5,
        working_days: 5,
        status: 'rejected',
      });
      await workspace.addVacationRequest(member, {
        start_date: '2025-12-01',
        end_date: '2025-12-05',
        days: 5,
        working_days: 5,
      });

      expect(await usageOnHome()).toEqual([
        'Annual leave: *16 available* / 20 total (*7* used, *5* working, +*3* carryover)',
        'Bonus Days: *1 available* / 2 total (*1* used)',
      ]);
    });

    it('counts the vacation year from the contract start', async () => {
      await setUp({ vacation_days: 20 }, { contract_start_date: '2025-09-01' });
      // In the year that started on 2025-09-01.
      await workspace.addVacationRequest(member, {
        start_date: '2025-10-06',
        end_date: '2025-10-10',
        days: 5,
        working_days: 5,
      });
      // In the year before.
      await workspace.addVacationRequest(member, {
        start_date: '2025-08-04',
        end_date: '2025-08-08',
        days: 5,
        working_days: 5,
      });

      expect(await usageOnHome()).toEqual([
        'Annual leave: *15 available* / 20 total (*5* used)',
      ]);
    });

    // BUG?: usage only counts requests that start and end inside the vacation
    // year (vacation-period-usage.service.ts:61-62), so a vacation across the
    // start of the year counts in neither year.
    it.failing(
      'counts a vacation that crosses the start of the year',
      async () => {
        await setUp(
          { vacation_days: 20 },
          { contract_start_date: '2025-09-01' },
        );
        await workspace.addVacationRequest(member, {
          start_date: '2025-08-29',
          end_date: '2025-09-04',
          days: 7,
          working_days: 5,
        });

        const [annualLeave] = await usageOnHome();

        expect(annualLeave).not.toMatch(/^Annual leave: \*20 available\*/);
      },
    );
  });

  describe('requesting', () => {
    it('refuses more calendar days than are left', async () => {
      await setUp({ vacation_days: 3, working_days: 20 });

      const response = await request();

      expect(modalError(response.view)).toBe(
        'Not enough vacation days. Requested: 5, available: 3',
      );
      expect(await workspace.rows('vacation_requests')).toEqual([]);
    });

    it('refuses more working days than are left', async () => {
      await setUp({ vacation_days: 30, working_days: 4 });

      const response = await request();

      expect(modalError(response.view)).toBe(
        'Not enough working days. Requested: 5, available: 4',
      );
    });

    it('refuses more bonus days than are left', async () => {
      await setUp({ bonus_days: 1 });
      const { start } = workWeek(1);

      const response = await submitVacationRequest(t, workspace, member, {
        start,
        end: addDays(start, 1),
        type: VacationType.BonusDay,
      });

      expect(modalError(response.view)).toBe(
        'Not enough bonus days. Requested: 2, available: 1',
      );
    });

    it('does not limit sick leave', async () => {
      await setUp({ vacation_days: 0, working_days: 1 });

      const response = await request(VacationType.SickLeave);

      expect(sectionTexts(response.view).join()).toContain(
        'created successfully',
      );
    });

    it("leaves out the policy's enabled holidays from the working days", async () => {
      await setUp({ vacation_days: 30, working_days: 30 });
      const otherPolicy = await workspace.addVacationPolicy();
      const week = workWeek(1);
      const holiday = (date: string, fields = {}) =>
        t.db.from('holidays').insert({
          slack_team_id: workspace.id,
          vacation_policy_id: policy.id,
          name: 'Holiday',
          date,
          year: 2026,
          created_by: member.id,
          ...fields,
        });
      // Tuesday counts as a holiday; Wednesday's is disabled, Thursday's
      // belongs to another policy.
      await holiday('2026-06-23');
      await holiday('2026-06-24', { is_disabled: true });
      await holiday('2026-06-25', { vacation_policy_id: otherPolicy.id });

      await request(VacationType.AnnualLeave, week);

      expect(await workspace.rows('vacation_requests')).toEqual([
        expect.objectContaining({
          start_date: week.start,
          days: 5,
          working_days: 4,
        }),
      ]);
    });
  });
});
