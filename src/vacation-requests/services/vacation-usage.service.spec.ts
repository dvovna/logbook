import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { VacationPeriodUsageService } from 'src/vacation-requests/services/vacation-period-usage.service';
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

describe('VacationsUsageService', () => {
  let periodUsageService: { getPeriodUsage: jest.Mock };
  let teamRules: { forTeam: jest.Mock };
  let policiesService: { findOne: jest.Mock };
  let service: VacationsUsageService;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-06T12:00:00Z') });

    periodUsageService = {
      getPeriodUsage: jest.fn().mockResolvedValue({
        annualLeaveUsed: 5,
        annualLeaveWorkingDaysUsed: 5,
        bonusUsed: 0,
        sickUsed: 2,
        unpaidUsed: 0,
        otherUsed: 0,
      }),
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

    expect(periodUsageService.getPeriodUsage).toHaveBeenCalledWith(
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
    expect(periodUsageService.getPeriodUsage).toHaveBeenLastCalledWith(
      user,
      new Date('2027-01-01T00:00:00Z'),
      new Date('2027-12-31T00:00:00Z'),
      { excludeRequestId: 'request-1', ownRules: expect.any(Promise) },
    );
  });
});
