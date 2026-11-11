import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import {
  IVacationDaysUsage,
  VacationPeriodUsageService,
} from 'src/vacation-requests/services/vacation-period-usage.service';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
import VacationPoliciesService from 'src/vacation-policies/services/vacation-policies.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';

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

const used = (
  days: number,
  workingDays: number,
  more: Partial<IVacationDaysUsage> = {},
): IVacationDaysUsage => ({
  annualLeaveUsed: days,
  annualLeaveWorkingDaysUsed: workingDays,
  bonusUsed: 0,
  sickUsed: 0,
  unpaidUsed: 0,
  otherUsed: 0,
  ...more,
});

describe('VacationsUsageService', () => {
  let periodUsageService: { getUsageByPeriods: jest.Mock };
  let teamRules: { forTeam: jest.Mock };
  let policiesService: { findOne: jest.Mock };
  let service: VacationsUsageService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-06T12:00:00Z') });

    periodUsageService = {
      getUsageByPeriods: jest
        .fn()
        .mockImplementation(async (_user, periods: unknown[]) =>
          periods.map(() => used(5, 5, { sickUsed: 2 })),
        ),
    };
    teamRules = {
      forTeam: jest.fn().mockResolvedValue({ vacationPolicyId: null }),
    };
    policiesService = { findOne: jest.fn() };

    service = new VacationsUsageService(
      teamRules as unknown as TeamRulesService,
      periodUsageService as unknown as VacationPeriodUsageService,
      policiesService as unknown as VacationPoliciesService,
    );
  });

  afterEach(() => jest.useRealTimers());

  it('tracks usage over the calendar year when there is no contract start date', async () => {
    const user = buildUser();

    const result = await service.getCurrentVacationPeriodUsage(user);

    expect(periodUsageService.getUsageByPeriods).toHaveBeenCalledWith(
      user,
      [
        {
          periodStart: new Date('2026-01-01T00:00:00Z'),
          periodEnd: new Date('2026-12-31T00:00:00Z'),
        },
      ],
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
    expect(periodUsageService.getUsageByPeriods).toHaveBeenLastCalledWith(
      user,
      [
        {
          periodStart: new Date('2027-01-01T00:00:00Z'),
          periodEnd: new Date('2027-12-31T00:00:00Z'),
        },
      ],
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

    const usageIn2026 = (yearsBefore: IVacationDaysUsage[], entered = 0) => {
      periodUsageService.getUsageByPeriods.mockImplementation(
        async (_user, periods: unknown[]) => {
          expect(periods).toHaveLength(yearsBefore.length + 1);

          return [...yearsBefore, used(0, 0)];
        },
      );

      return service.getCurrentVacationPeriodUsage(
        buildUser({
          // Joined in the first of the years before.
          created_at: `${2026 - yearsBefore.length}-03-10T00:00:00Z`,
          carryover_days: entered,
        }),
      );
    };

    it("carries what was left of last year, up to the policy's most", async () => {
      // 2024 left all its days (20 and 15), 2025 left 3 and 1 of its own
      // plus the 5 it carried.
      const { limits } = await usageIn2026([used(0, 0), used(17, 14)]);

      expect(limits).toMatchObject({
        carryoverDays: 5,
        carryoverWorkingDays: 5,
        daysTotal: 25,
      });
    });

    it('carries calendar and working days apart', async () => {
      // 2025 had only what HR entered (2), and left 2 + 20 - 21 = 1 calendar
      // and 2 + 15 - 14 = 3 working days.
      const { limits, usage } = await usageIn2026([used(21, 14)], 2);

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
      const { limits } = await usageIn2026([used(10, 8), used(30, 20)]);

      expect(limits).toMatchObject({
        carryoverDays: 0,
        carryoverWorkingDays: 0,
      });
    });
  });
});
