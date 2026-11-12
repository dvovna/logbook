import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import HolidaysService from '@modules/holidays/services/holidays.service';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { LeaveBalancesService } from '@modules/vacation-requests/services/leave-balances.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { VacationPeriodUsageService } from '@modules/vacation-requests/services/vacation-period-usage.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { ConfigService } from '@nestjs/config';
import { ILeaveBalance } from '@modules/vacation-requests/types/leave-balance.interface';
import {
  ICountedRequest,
  toStoredBalance,
} from '@modules/vacation-requests/utils/leave-balance.utils';
import { LeaveFileStateService } from 'src/leave-file/services/leave-file-state.service';
import { ILeaveHistoryRow } from 'src/leave-file/types/leave-file-row.interface';

const teamPolicy = { id: 'team-policy' } as IVacationPolicyViewModel;
const companyPolicy = { id: 'company-policy' } as IVacationPolicyViewModel;

const person = (id: string, fields: Partial<IUserViewModel> = {}) =>
  ({
    id,
    email: `${id}@x.test`,
    name: id,
    role: UserRole.Member,
    is_active: true,
    team_id: null,
    slack_team_id: 'workspace-1',
    slack_id: `S${id}`,
    created_at: '2026-01-01T00:00:00Z',
    ...fields,
  }) as IUserViewModel;

const anna = person('anna', { team_id: 'team-1' });
const ben = person('ben');
// A team of its own rules without a policy.
const cleo = person('cleo', { team_id: 'own-team' });
const dora = person('dora', { is_active: false });

const annaRequests: ICountedRequest[] = [
  {
    id: 'request-1',
    status: VacationRequestStatus.Approved,
    type: VacationType.AnnualLeave,
    startDate: '2026-03-02',
    endDate: '2026-03-06',
    workingDates: ['2026-03-02'],
  },
];

const annaBalance = {
  id: 'balance-1',
  slack_team_id: 'workspace-1',
  user_id: 'anna',
  balance_on: '2026-06-01',
  days_left: 3,
  working_days_left: null,
  bonus_days_left: 1,
  upload_id: 'older-upload',
  set_by: 'hr-1',
  created_at: '2026-06-01T10:00:00.000000+00:00',
  updated_at: '2026-06-01T10:00:00.000000+00:00',
} as ILeaveBalance;

const historyRow = (from: string, to: string): ILeaveHistoryRow => ({
  row: 2,
  name: '',
  email: 'anna@x.test',
  leaveType: 'Annual leave',
  from,
  to,
  comment: '',
});

describe('LeaveFileStateService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const build = () => {
    const usersService = {
      findMany: jest.fn().mockResolvedValue([anna, ben, cleo, dora]),
    };
    const teamRulesService = {
      forWorkspace: jest.fn().mockResolvedValue({
        companyRules: { vacation_policy_id: 'company-policy' },
        teams: [
          { team: { id: 'team-1' }, vacationPolicyId: 'team-policy' },
          { team: { id: 'own-team' }, vacationPolicyId: null },
        ],
      }),
    };
    const policiesService = {
      findMany: jest.fn().mockResolvedValue([teamPolicy, companyPolicy]),
    };
    const periodUsage = {
      countedRequestsOfUsers: jest
        .fn()
        .mockResolvedValue(new Map([['anna', annaRequests]])),
    };
    const balancesService = {
      findOfUsers: jest.fn().mockResolvedValue([annaBalance]),
    };
    const realDays = new VacationDaysCalculationService({} as HolidaysService);
    const days = {
      // December 24 is a holiday of the team's policy.
      holidayDatesByPolicy: jest
        .fn()
        .mockResolvedValue(new Map([['team-policy', new Set(['2026-12-24'])]])),
      workingDatesWithout: (start: Date, end: Date, holidays: Set<string>) =>
        realDays.workingDatesWithout(start, end, holidays),
    };
    const requestsService = {
      countByUser: jest.fn().mockResolvedValue(new Map([['anna', 7]])),
    };
    const config = {
      getOrThrow: jest.fn((name: string) =>
        name === 'MAX_REQUESTS_PER_USER' ? 500 : undefined,
      ),
    };
    const service = new LeaveFileStateService(
      usersService as unknown as UsersService,
      teamRulesService as unknown as TeamRulesService,
      policiesService as unknown as VacationPoliciesService,
      periodUsage as unknown as VacationPeriodUsageService,
      balancesService as unknown as LeaveBalancesService,
      days as unknown as VacationDaysCalculationService,
      requestsService as unknown as VacationRequestsService,
      config as unknown as ConfigService,
    );

    return {
      service,
      usersService,
      teamRulesService,
      policiesService,
      periodUsage,
      balancesService,
      days,
      requestsService,
    };
  };

  describe('balancesState', () => {
    it("holds everyone, each person's policy by their team, and the requests and earlier balances of active people", async () => {
      const built = build();

      const state = await built.service.balancesState('workspace-1');

      expect(state).toEqual({
        today: '2026-11-12',
        people: [anna, ben, cleo, dora],
        policyOf: new Map([
          ['anna', teamPolicy],
          ['ben', companyPolicy],
          ['cleo', null],
          ['dora', companyPolicy],
        ]),
        requestsOf: new Map([['anna', annaRequests]]),
        balanceOf: new Map([['anna', toStoredBalance(annaBalance)]]),
      });
      expect(built.usersService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
        includeInactive: true,
      });
      expect(built.teamRulesService.forWorkspace).toHaveBeenCalledWith(
        'workspace-1',
      );
      expect(built.policiesService.findMany).toHaveBeenCalledWith({
        slackTeamId: 'workspace-1',
      });
      expect(built.balancesService.findOfUsers).toHaveBeenCalledWith(
        ['anna', 'ben', 'cleo'],
        'workspace-1',
      );
    });

    it('reads the requests of two years before and after today', async () => {
      const built = build();

      await built.service.balancesState('workspace-1');

      expect(built.periodUsage.countedRequestsOfUsers).toHaveBeenCalledWith(
        [anna, ben, cleo],
        new Date('2024-11-12'),
        new Date('2028-11-12'),
      );
      expect(built.days.holidayDatesByPolicy).not.toHaveBeenCalled();
    });
  });

  describe('historyState', () => {
    it("reads the requests and holidays from the file's earliest date when it is more than two years ago", async () => {
      const built = build();

      const state = await built.service.historyState('workspace-1', [
        historyRow('2026-12-21', '2026-12-24'),
        historyRow('04.05.2019', '10.05.2019'),
        historyRow('soon', ''),
      ]);

      expect(built.periodUsage.countedRequestsOfUsers).toHaveBeenCalledWith(
        [anna, ben, cleo],
        new Date('2019-05-04'),
        new Date('2028-11-12'),
      );
      expect(built.days.holidayDatesByPolicy).toHaveBeenCalledWith(
        'workspace-1',
        new Date('2019-05-04'),
        new Date('2028-11-12'),
      );
      expect(state).toMatchObject({
        today: '2026-11-12',
        people: [anna, ben, cleo, dora],
        requestsOf: new Map([['anna', annaRequests]]),
        balanceOf: new Map([['anna', toStoredBalance(annaBalance)]]),
        maxRequestsPerUser: 500,
        requestCountOf: new Map([['anna', 7]]),
      });
      expect(state.policyOf.get('anna')).toBe(teamPolicy);
      expect(built.requestsService.countByUser).toHaveBeenCalledWith(
        'workspace-1',
      );
    });

    it('reads two years before and after today when the dates are within them, slash dates read the way the file writes them', async () => {
      const built = build();

      await built.service.historyState('workspace-1', [
        historyRow('12/21/2026', '12/24/2026'),
        historyRow('', ''),
      ]);

      expect(built.periodUsage.countedRequestsOfUsers).toHaveBeenCalledWith(
        [anna, ben, cleo],
        new Date('2024-11-12'),
        new Date('2028-11-12'),
      );
    });

    it("counts a leave's working days with the holidays of the person's current team", async () => {
      const { service } = build();

      const state = await service.historyState('workspace-1', []);

      expect(state.workingDatesOf('anna', '2026-12-21', '2026-12-27')).toEqual([
        '2026-12-21',
        '2026-12-22',
        '2026-12-23',
        '2026-12-25',
      ]);
      expect(state.workingDatesOf('ben', '2026-12-21', '2026-12-25')).toEqual([
        '2026-12-21',
        '2026-12-22',
        '2026-12-23',
        '2026-12-24',
        '2026-12-25',
      ]);
    });
  });
});
