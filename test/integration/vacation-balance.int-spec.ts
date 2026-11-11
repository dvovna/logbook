import UserRole from '@common/enums/user-role.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { Tables, TablesInsert } from '@common/types/database.types';
import { createTestApp, ITestApp } from './support/test-app';
import { TestWorkspace } from './support/test-workspace';
import { addDays, workWeek } from './support/dates';
import { openAppHomeTab, openModalFrom } from './support/app-home';
import { modalError, sectionTexts } from './support/tab-readers';
import {
  requestVacation,
  submitVacationRequest,
} from './support/vacation-flows';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { NavigationActionId } from '@modules/slack/common/enums/navigation-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';

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
        text.startsWith('Annual leave') || text.startsWith('Bonus days'),
    );

  const addHoliday = (date: string, fields = {}) =>
    t.db
      .insertInto('holidays')
      .values({
        slack_team_id: workspace.id,
        vacation_policy_id: policy.id,
        name: 'Holiday',
        date,
        year: Number(date.slice(0, 4)),
        created_by: member.id,
        ...fields,
      })
      .execute();

  const request = (type = VacationType.AnnualLeave, week = workWeek(1)) =>
    submitVacationRequest(t, workspace, member, { ...week, type });

  describe('on Home', () => {
    it('shows what is left of the policy, with carryover', async () => {
      await setUp(
        {
          vacation_days: 20,
          working_days: 15,
          bonus_days: 2,
          carryover_days: 5,
        },
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
        'Bonus days: *1 available* / 2 total (*1* used)',
      ]);
    });

    describe('for someone who joined in an earlier year', () => {
      const joinedLastYear = { created_at: '2025-02-01T09:00:00Z' };

      it("carries over what was left of last year, up to the policy's most", async () => {
        await setUp(
          { vacation_days: 20, working_days: 20, carryover_days: 5 },
          joinedLastYear,
        );
        // 12 days in 2025, so 8 are left; 5 may carry over.
        await workspace.addVacationRequest(member, {
          start_date: '2025-03-02',
          end_date: '2025-03-13',
        });

        expect(await usageOnHome()).toEqual([
          'Annual leave: *25 available* / 20 total (+*5* carryover)',
        ]);
      });

      it('starts from the carryover HR entered for the year they joined', async () => {
        await setUp(
          { vacation_days: 20, working_days: 20, carryover_days: 5 },
          { ...joinedLastYear, carryover_days: 2 },
        );
        // Three weeks in 2025: 20 + 2 - 21 leaves 1 day.
        await workspace.addVacationRequest(member, {
          start_date: '2025-03-03',
          end_date: '2025-03-23',
        });

        expect(await usageOnHome()).toEqual([
          'Annual leave: *21 available* / 20 total (+*1* carryover)',
        ]);
      });

      it('carries nothing over when the policy allows none', async () => {
        await setUp({ vacation_days: 20, working_days: 20 }, joinedLastYear);

        expect(await usageOnHome()).toEqual([
          'Annual leave: *20 available* / 20 total',
        ]);
      });
    });

    it('says there is no limit when no policy applies', async () => {
      member = await workspace.addUser({ role: UserRole.Member });
      await workspace.addVacationRequest(member, {
        start_date: '2026-03-02',
        end_date: '2026-03-06',
        days: 5,
        working_days: 5,
      });

      expect(await usageOnHome()).toEqual([
        'Annual leave: *5* used · no limit (no vacation policy applies to you)',
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

    it('counts the days of a vacation that fall in this vacation year', async () => {
      await setUp({ vacation_days: 20 }, { contract_start_date: '2025-09-01' });
      // Friday to Thursday: the year starts on Monday, September 1.
      await workspace.addVacationRequest(member, {
        start_date: '2025-08-29',
        end_date: '2025-09-04',
        days: 7,
        working_days: 5,
      });

      // A holiday of the policy in the part that counts.
      await t.db
        .insertInto('holidays')
        .values({
          slack_team_id: workspace.id,
          vacation_policy_id: policy.id,
          name: 'Holiday',
          date: '2025-09-02',
          year: 2025,
          created_by: member.id,
        })
        .execute();

      expect(await usageOnHome()).toEqual([
        'Annual leave: *16 available* / 20 total (*4* used, *3* working)',
      ]);
    });

    it('counts a holiday added after the request was made', async () => {
      await setUp({ vacation_days: 30, working_days: 30 });
      const week = workWeek(1);
      await requestVacation(t, workspace, member, week);

      await addHoliday(addDays(week.start, 1));

      expect(await usageOnHome()).toEqual([
        'Annual leave: *25 available* / 30 total (*5* used, *4* working)',
      ]);
    });
  });

  describe('requesting', () => {
    it('refuses more calendar days than are left', async () => {
      await setUp({ vacation_days: 3, working_days: 20 });

      const response = await request();

      expect(response).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block:
            'Not enough vacation days. Requested: 5, available: 3',
        },
      });
      expect(await workspace.rows('vacation_requests')).toEqual([]);
    });

    it('refuses more working days than are left', async () => {
      await setUp({ vacation_days: 30, working_days: 4 });

      const response = await request();

      expect(response).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block: 'Not enough working days. Requested: 5, available: 4',
        },
      });
    });

    it('refuses more bonus days than are left', async () => {
      await setUp({ bonus_days: 1 });
      const { start } = workWeek(1);

      const response = await submitVacationRequest(t, workspace, member, {
        start,
        end: addDays(start, 1),
        type: VacationType.BonusDay,
      });

      expect(response).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block: 'Not enough bonus days. Requested: 2, available: 1',
        },
      });
    });

    it('counts bonus days in working days', async () => {
      await setUp({ bonus_days: 2 });
      const { start } = workWeek(1);

      // Friday to Monday: two working days.
      const response = await submitVacationRequest(t, workspace, member, {
        start: addDays(start, 4),
        end: addDays(start, 7),
        type: VacationType.BonusDay,
      });

      expect(response).toEqual({ response_action: 'clear' });
      expect(await usageOnHome()).toEqual([
        expect.stringMatching(/^Annual leave/),
        'Bonus days: *0 available* / 2 total (*2* used)',
      ]);
    });

    it('does not limit sick leave', async () => {
      await setUp({ vacation_days: 0, working_days: 1 });

      const response = await request(VacationType.SickLeave);

      expect(response).toEqual({ response_action: 'clear' });
      expect(await workspace.rows('vacation_requests')).toHaveLength(1);
    });

    it("leaves out the policy's enabled holidays from the working days", async () => {
      await setUp({ vacation_days: 30, working_days: 30 });
      const otherPolicy = await workspace.addVacationPolicy();
      const week = workWeek(1);
      // Tuesday counts as a holiday; Wednesday's is disabled, Thursday's
      // belongs to another policy.
      await addHoliday('2026-06-23');
      await addHoliday('2026-06-24', { is_disabled: true });
      await addHoliday('2026-06-25', { vacation_policy_id: otherPolicy.id });

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

  describe('a request in another vacation year', () => {
    it("checks next year's request against next year, not this one", async () => {
      await setUp({ vacation_days: 10, working_days: 10 });
      await workspace.addVacationRequest(member, {
        start_date: '2026-03-02',
        end_date: '2026-03-11',
      });

      const response = await submitVacationRequest(t, workspace, member, {
        start: '2027-01-04',
        end: '2027-01-08',
      });

      expect(response).toEqual({ response_action: 'clear' });
    });

    it("refuses more than next year's policy allows, naming the year", async () => {
      await setUp({ vacation_days: 10, working_days: 10 });
      await workspace.addVacationRequest(member, {
        start_date: '2027-01-04',
        end_date: '2027-01-13',
      });

      const response = await submitVacationRequest(t, workspace, member, {
        start: '2027-02-01',
        end: '2027-02-05',
      });

      expect(response).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block:
            'Not enough vacation days in the vacation year from 1 Jan 2027. Requested: 5, available: 0',
        },
      });
    });

    it("gives next year no carryover: it is this year's", async () => {
      await setUp({ vacation_days: 3, working_days: 3 }, { carryover_days: 2 });

      const response = await submitVacationRequest(t, workspace, member, {
        start: '2027-01-04',
        end: '2027-01-08',
      });

      expect(response).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block:
            'Not enough vacation days in the vacation year from 1 Jan 2027. Requested: 5, available: 3',
        },
      });
    });

    it('checks the days on each side of the anniversary against their year', async () => {
      await setUp({ vacation_days: 5 }, { contract_start_date: '2025-07-01' });
      // 4 days used in the year that ends on 2026-06-30.
      await workspace.addVacationRequest(member, {
        start_date: '2026-02-02',
        end_date: '2026-02-05',
      });

      // Two days before the anniversary, three after: 4 + 2 > 5.
      const response = await submitVacationRequest(t, workspace, member, {
        start: '2026-06-29',
        end: '2026-07-03',
      });

      expect(response).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block:
            'Not enough vacation days. Requested: 2, available: 1',
        },
      });
    });
  });

  describe('editing a request', () => {
    let hr: Tables<'users'>;

    beforeEach(async () => {
      hr = await workspace.addUser({ role: UserRole.HR });
    });

    const edit = async (
      request: Tables<'vacation_requests'>,
      values: Record<string, string>,
    ) => {
      const form = await openModalFrom(
        t,
        workspace,
        hr,
        await openAppHomeTab(t, workspace, hr, [
          NavigationActionId.TimeOff,
          NavigationActionId.AllRequests,
        ]),
        VacationRequestsTabViewActionId.ManageRequestMenu,
        `${VacationRequestsTabViewActionId.EditRequest}:${request.id}`,
      );
      const response = await t.slack
        .submitView(workspace, hr, form, {
          [VacationRequestsTabViewActionId.UserField]: member.id,
          status: request.status,
          start_date: request.start_date,
          end_date: request.end_date,
          type_option: request.type,
          ...values,
        })
        .expect(200);

      return response.body;
    };

    it('moves a request without counting it twice', async () => {
      await setUp({ vacation_days: 8, working_days: 8 });
      const request = await requestVacation(t, workspace, member, workWeek(2));
      const moved = workWeek(3);

      expect(
        await edit(request, { start_date: moved.start, end_date: moved.end }),
      ).toEqual({ response_action: 'clear' });
      expect(await workspace.row('vacation_requests', request.id)).toEqual(
        expect.objectContaining({ start_date: moved.start }),
      );
    });

    it('checks the balance when sick leave becomes annual leave', async () => {
      await setUp({ vacation_days: 3, working_days: 3 });
      const request = await workspace.addVacationRequest(member, {
        start_date: workWeek(2).start,
        end_date: workWeek(2).end,
        type: VacationType.SickLeave,
        days: 5,
        working_days: 5,
      });

      expect(
        await edit(request, { type_option: VacationType.AnnualLeave }),
      ).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block:
            'Not enough vacation days. Requested: 5, available: 3',
        },
      });
    });

    it('checks the balance when a rejected request is approved after all', async () => {
      await setUp({ vacation_days: 3, working_days: 3 });
      const request = await workspace.addVacationRequest(member, {
        start_date: workWeek(2).start,
        end_date: workWeek(2).end,
        status: VacationRequestStatus.Rejected,
      });

      expect(
        await edit(request, { status: VacationRequestStatus.Approved }),
      ).toEqual({
        response_action: 'errors',
        errors: {
          end_date_block:
            'Not enough vacation days. Requested: 5, available: 3',
        },
      });
    });
  });
});
