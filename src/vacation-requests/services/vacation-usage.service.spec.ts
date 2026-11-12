import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { VacationPeriodUsageService } from 'src/vacation-requests/services/vacation-period-usage.service';
import { LeaveBalancesService } from 'src/vacation-requests/services/leave-balances.service';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { ICountedRequest } from 'src/vacation-requests/utils/leave-balance.utils';
import { ILeaveBalance } from 'src/vacation-requests/types/leave-balance.interface';
import UserRole from 'src/common/enums/user-role.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { DAY_MS } from 'src/common/utils/date.utils';

const SLACK_TEAM_ID = 'slack-team-1';

const buildUser = (
  overrides: Partial<IUserViewModel> = {},
): IUserViewModel => ({
  id: 'user-1',
  email: 'member@example.com',
  name: 'Member',
  role: UserRole.Member,
  is_active: true,
  team_id: 'team-1',
  slack_team_id: SLACK_TEAM_ID,
  slack_id: 'U_MEMBER',
  created_at: '2026-01-01T00:00:00Z',
  contract_start_date: null,
  carryover_days: 0,
  ...overrides,
});

// `days` days from `start`, the first `workingDays` of them working days.
const leave = (
  start: string,
  days: number,
  workingDays = days,
  type = VacationType.AnnualLeave,
): ICountedRequest => {
  const dates = Array.from({ length: days }, (_, index) =>
    new Date(new Date(start).getTime() + index * DAY_MS)
      .toISOString()
      .slice(0, 10),
  );

  return {
    id: `${type}-${start}`,
    status: VacationRequestStatus.Approved,
    type,
    startDate: start,
    endDate: dates[days - 1],
    workingDates: dates.slice(0, workingDays),
  };
};

const fileBalance = (fields: Partial<ILeaveBalance>): ILeaveBalance => ({
  id: 'balance-1',
  slack_team_id: SLACK_TEAM_ID,
  user_id: 'user-1',
  balance_on: '2026-11-06',
  days_left: null,
  working_days_left: null,
  bonus_days_left: null,
  upload_id: 'upload-1',
  set_by: 'hr-1',
  created_at: '2026-11-06T09:00:00Z',
  updated_at: '2026-11-06T09:00:00Z',
  ...fields,
});

describe('VacationsUsageService', () => {
  let periodUsageService: { countedRequests: jest.Mock };
  let teamRules: { forTeam: jest.Mock };
  let policiesService: { findOne: jest.Mock };
  let leaveBalances: { findOfUser: jest.Mock };
  let service: VacationsUsageService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-06T12:00:00Z') });

    periodUsageService = {
      countedRequests: jest
        .fn()
        .mockResolvedValue([
          leave('2026-03-02', 5),
          leave('2026-05-04', 2, 2, VacationType.SickLeave),
        ]),
    };
    teamRules = {
      forTeam: jest.fn().mockResolvedValue({ vacationPolicyId: null }),
    };
    policiesService = { findOne: jest.fn() };
    leaveBalances = { findOfUser: jest.fn().mockResolvedValue(null) };

    service = new VacationsUsageService(
      teamRules as unknown as TeamRulesService,
      periodUsageService as unknown as VacationPeriodUsageService,
      policiesService as unknown as VacationPoliciesService,
      leaveBalances as unknown as LeaveBalancesService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('tracks usage over the calendar year when there is no contract start date', async () => {
    const user = buildUser();

    const result = await service.getCurrentVacationPeriodUsage(user);

    expect(periodUsageService.countedRequests).toHaveBeenCalledWith(
      user,
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      { excludeRequestId: undefined, ownRules: expect.any(Promise) },
    );
    expect(result.usage.annual_leave.used).toBe(5);
    expect(result.usage.sick_leave.used).toBe(2);
  });

  it('has no limits when no vacation policy applies', async () => {
    const result = await service.getCurrentVacationPeriodUsage(buildUser());

    expect(result.limits).toBeNull();
  });

  it('takes limits from the policy the team follows even without a contract start date', async () => {
    teamRules.forTeam.mockResolvedValue({ vacationPolicyId: 'policy-1' });
    policiesService.findOne.mockResolvedValue({
      vacation_days: 24,
      working_days: 20,
      bonus_days: 3,
    });

    const result = await service.getCurrentVacationPeriodUsage(buildUser());

    expect(result.limits).toEqual(
      expect.objectContaining({ vacationDays: 24, workingDays: 20 }),
    );
    expect(result.usage.annual_leave.available).toBe(19);
    expect(teamRules.forTeam).toHaveBeenCalledWith('team-1', SLACK_TEAM_ID);
    expect(policiesService.findOne).toHaveBeenCalledWith({
      id: 'policy-1',
      slackTeamId: SLACK_TEAM_ID,
    });
  });

  it('counts carryover only in the current vacation year', async () => {
    teamRules.forTeam.mockResolvedValue({ vacationPolicyId: 'policy-1' });
    policiesService.findOne.mockResolvedValue({
      vacation_days: 20,
      working_days: 20,
      bonus_days: 0,
      carryover_days: 5,
    });
    const user = buildUser({ carryover_days: 3 });

    const thisYear = await service.getCurrentVacationPeriodUsage(user);
    const nextYear = await service.getVacationPeriodUsage(
      user,
      new Date('2027-02-01'),
      { excludeRequestId: 'request-1' },
    );

    expect(thisYear.limits?.daysTotal).toBe(23);
    expect(nextYear.periodStart).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(nextYear.limits?.daysTotal).toBe(20);
    expect(periodUsageService.countedRequests).toHaveBeenLastCalledWith(
      user,
      new Date('2027-01-01T00:00:00Z'),
      new Date('2027-12-31T00:00:00Z'),
      { excludeRequestId: 'request-1', ownRules: expect.any(Promise) },
    );
  });

  describe('carryover of a person who joined in an earlier year', () => {
    beforeEach(() => {
      teamRules.forTeam.mockResolvedValue({ vacationPolicyId: 'policy-1' });
      policiesService.findOne.mockResolvedValue({
        vacation_days: 20,
        working_days: 15,
        bonus_days: 0,
        carryover_days: 5,
      });
    });

    // The annual leave of each year before, in calendar and working days.
    const usageIn2026 = async (
      yearsBefore: [number, number][],
      entered = 0,
    ) => {
      const joined = 2026 - yearsBefore.length;
      periodUsageService.countedRequests.mockResolvedValue(
        yearsBefore.flatMap(([days, workingDays], index) =>
          days ? [leave(`${joined + index}-03-02`, days, workingDays)] : [],
        ),
      );

      const result = await service.getCurrentVacationPeriodUsage(
        buildUser({
          // Joined in the first of the years before.
          created_at: `${joined}-03-10T00:00:00Z`,
          carryover_days: entered,
        }),
      );

      expect(periodUsageService.countedRequests).toHaveBeenCalledWith(
        expect.anything(),
        new Date(`${joined}-01-01T00:00:00Z`),
        new Date('2026-12-31T00:00:00Z'),
        expect.anything(),
      );

      return result;
    };

    it("carries what was left of last year, up to the policy's most", async () => {
      // 2024 left all its days (20 and 15), 2025 left 3 and 1 of its own
      // plus the 5 it carried.
      const { limits } = await usageIn2026([
        [0, 0],
        [17, 14],
      ]);

      expect(limits).toMatchObject({
        carryoverDays: 5,
        carryoverWorkingDays: 5,
        daysTotal: 25,
      });
    });

    it('carries calendar and working days apart', async () => {
      // 2025 had only what HR entered (2), and left 2 + 20 - 21 = 1 calendar
      // and 2 + 15 - 14 = 3 working days.
      const { limits, usage } = await usageIn2026([[21, 14]], 2);

      expect(limits).toMatchObject({
        carryoverDays: 1,
        carryoverWorkingDays: 3,
      });
      expect(usage.annual_leave).toMatchObject({
        available: 21,
        working_days_available: 18,
      });
    });

    it('carries nothing from a year used up', async () => {
      const { limits } = await usageIn2026([
        [10, 8],
        [30, 20],
      ]);

      expect(limits).toMatchObject({
        carryoverDays: 0,
        carryoverWorkingDays: 0,
      });
    });
  });

  describe('with a balance from a file', () => {
    beforeEach(() => {
      teamRules.forTeam.mockResolvedValue({ vacationPolicyId: 'policy-1' });
      policiesService.findOne.mockResolvedValue({
        vacation_days: 24,
        working_days: 20,
        bonus_days: 3,
        carryover_days: 5,
      });
    });

    it('counts what the file says was left, read beside the requests', async () => {
      leaveBalances.findOfUser.mockResolvedValue(
        fileBalance({ days_left: 12 }),
      );

      const { usage, limits } =
        await service.getCurrentVacationPeriodUsage(buildUser());

      expect(usage.annual_leave.available).toBe(12);
      expect(limits?.correction).toEqual({
        balanceOn: '2026-11-06',
        days: -7,
        workingDays: null,
        bonusDays: null,
      });
      expect(leaveBalances.findOfUser).toHaveBeenCalledWith(
        'user-1',
        SLACK_TEAM_ID,
      );
      expect(periodUsageService.countedRequests).toHaveBeenCalledTimes(1);
    });

    it('reads the requests again from the year of a balance before the year the person joined in', async () => {
      // The year runs from November 1: the balance of October 20 is in the
      // year before the one the person joined in.
      const user = buildUser({
        contract_start_date: '2020-11-01',
        created_at: '2026-11-03T09:00:00Z',
      });
      periodUsageService.countedRequests.mockResolvedValue([]);
      leaveBalances.findOfUser.mockResolvedValue(
        fileBalance({ balance_on: '2026-10-20', days_left: 12 }),
      );

      const { limits } = await service.getCurrentVacationPeriodUsage(user);

      expect(limits).toMatchObject({ carryoverDays: 5, correction: null });
      expect(periodUsageService.countedRequests.mock.calls).toEqual([
        [
          user,
          new Date('2026-11-01T00:00:00Z'),
          new Date('2027-10-31T00:00:00Z'),
          expect.anything(),
        ],
        [
          user,
          new Date('2025-11-01T00:00:00Z'),
          new Date('2027-10-31T00:00:00Z'),
          expect.anything(),
        ],
      ]);
    });
  });
});
