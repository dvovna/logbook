import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { VacationPeriodUsageService } from 'src/vacation-requests/services/vacation-period-usage.service';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
import HolidaysService from 'src/holidays/services/holidays.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import UserRole from 'src/common/enums/user-role.enum';

const SLACK_TEAM_ID = 'slack-team-1';

const buildUser = (id: string, teamId: string | null): IUserViewModel => ({
  id,
  email: `${id}@example.com`,
  name: id,
  role: UserRole.Member,
  is_active: true,
  team_id: teamId,
  slack_team_id: SLACK_TEAM_ID,
  slack_id: `U_${id}`,
  created_at: '2026-01-01T00:00:00Z',
  time_reminder: TimeReminder.Weekly,
});

const buildRequest = (
  userId: string,
  teamId: string | null,
  start_date: string,
  end_date: string,
): IVacationRequestViewModel => ({
  id: `${userId}-${start_date}`,
  start_date,
  end_date,
  days: 1,
  working_days: 1,
  type: VacationType.AnnualLeave,
  status: VacationRequestStatus.Approved,
  team: null,
  user: null,
  team_id: teamId,
  user_id: userId,
  slack_team_id: SLACK_TEAM_ID,
  created_at: null,
  updated_at: null,
  updated_by: null,
  created_by: null,
  leave_file_upload_id: null,
});

const FROM = new Date('2026-01-01');
const TO = new Date('2026-12-31');

describe('VacationPeriodUsageService', () => {
  let repository: { findMany: jest.Mock };
  let teamRules: { forTeam: jest.Mock; forWorkspace: jest.Mock };
  let holidays: { findMany: jest.Mock };
  let service: VacationPeriodUsageService;

  beforeEach(() => {
    repository = { findMany: jest.fn().mockResolvedValue([]) };
    teamRules = {
      forTeam: jest.fn().mockResolvedValue({ vacationPolicyId: null }),
      forWorkspace: jest.fn(),
    };
    holidays = { findMany: jest.fn().mockResolvedValue([]) };

    service = new VacationPeriodUsageService(
      repository as unknown as VacationRequestsRepository,
      teamRules as unknown as TeamRulesService,
      new VacationDaysCalculationService(
        holidays as unknown as HolidaysService,
      ),
    );
  });

  describe('countedRequests', () => {
    it("reads the requests that count, with their working days in the span from their team's holidays", async () => {
      const user = buildUser('anna', 'team-1');
      repository.findMany.mockResolvedValue([
        buildRequest('anna', 'team-1', '2026-03-02', '2026-03-06'),
        // Across the span's end, filed in no team.
        buildRequest('anna', null, '2026-12-30', '2027-01-05'),
      ]);
      holidays.findMany.mockResolvedValue([
        { vacation_policy_id: 'policy-1', date: '2026-03-03' },
      ]);

      const counted = await service.countedRequests(user, FROM, TO, {
        excludeRequestId: 'request-9',
        ownRules: Promise.resolve({ vacationPolicyId: 'policy-1' } as never),
      });

      expect(repository.findMany).toHaveBeenCalledWith({
        user_id: 'anna',
        slack_team_id: SLACK_TEAM_ID,
        start_date: { operator: 'lte', value: '2026-12-31' },
        end_date: { operator: 'gte', value: '2026-01-01' },
        status: {
          operator: 'in',
          value: [
            VacationRequestStatus.Approved,
            VacationRequestStatus.Pending,
          ],
        },
        id: { operator: 'neq', value: 'request-9' },
      });
      expect(counted).toEqual([
        {
          id: 'anna-2026-03-02',
          status: VacationRequestStatus.Approved,
          type: VacationType.AnnualLeave,
          startDate: '2026-03-02',
          endDate: '2026-03-06',
          workingDates: [
            '2026-03-02',
            '2026-03-04',
            '2026-03-05',
            '2026-03-06',
          ],
        },
        expect.objectContaining({
          startDate: '2026-12-30',
          endDate: '2027-01-05',
          workingDates: ['2026-12-30', '2026-12-31'],
        }),
      ]);
      // The own team's rules come from the caller; no team's are read.
      expect(teamRules.forTeam).toHaveBeenCalledTimes(1);
      expect(teamRules.forTeam).toHaveBeenCalledWith(null, SLACK_TEAM_ID);
    });
  });

  describe('countedRequestsOfUsers', () => {
    it('reads the requests, the rules and the holidays once for everyone', async () => {
      const users = [
        buildUser('anna', 'team-1'),
        buildUser('ben', null),
        buildUser('carla', 'team-1'),
      ];
      repository.findMany.mockResolvedValue([
        buildRequest('anna', 'team-1', '2026-03-02', '2026-03-06'),
        // A team of its own rules without a policy: no holidays.
        buildRequest('anna', 'team-own', '2026-03-02', '2026-03-03'),
        // No team: the company rules' policy.
        buildRequest('ben', null, '2026-03-02', '2026-03-06'),
      ]);
      teamRules.forWorkspace.mockResolvedValue({
        companyRules: { vacation_policy_id: 'policy-company' },
        teams: [
          { team: { id: 'team-1' }, vacationPolicyId: 'policy-1' },
          { team: { id: 'team-own' }, vacationPolicyId: null },
        ],
      });
      holidays.findMany.mockResolvedValue([
        { vacation_policy_id: 'policy-1', date: '2026-03-03' },
        { vacation_policy_id: 'policy-company', date: '2026-03-04' },
      ]);

      const counted = await service.countedRequestsOfUsers(users, FROM, TO);

      const workingDatesOf = (userId: string) =>
        counted.get(userId)!.map(({ workingDates }) => workingDates);
      expect(workingDatesOf('anna')).toEqual([
        ['2026-03-02', '2026-03-04', '2026-03-05', '2026-03-06'],
        ['2026-03-02', '2026-03-03'],
      ]);
      expect(workingDatesOf('ben')).toEqual([
        ['2026-03-02', '2026-03-03', '2026-03-05', '2026-03-06'],
      ]);
      expect(workingDatesOf('carla')).toEqual([]);
      expect(repository.findMany).toHaveBeenCalledTimes(1);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: ['anna', 'ben', 'carla'],
          slack_team_id: SLACK_TEAM_ID,
        }),
      );
      expect(teamRules.forWorkspace).toHaveBeenCalledTimes(1);
      expect(holidays.findMany).toHaveBeenCalledTimes(1);
      expect(teamRules.forTeam).not.toHaveBeenCalled();
    });

    it('reads nothing for nobody', async () => {
      expect(await service.countedRequestsOfUsers([], FROM, TO)).toEqual(
        new Map(),
      );
      expect(repository.findMany).not.toHaveBeenCalled();
      expect(teamRules.forWorkspace).not.toHaveBeenCalled();
    });
  });
});
