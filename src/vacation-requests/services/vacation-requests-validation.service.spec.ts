import { ConfigService } from '@nestjs/config';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import {
  IVacationLimits,
  IVacationPeriodUsageData,
} from 'src/vacation-requests/types/user-vacations-usage-info.interface';

const SLACK_TEAM_ID = 'slack-team-1';
const USER_ID = 'user-1';

describe('VacationRequestsValidationService', () => {
  let repository: { findMany: jest.Mock };
  let service: VacationRequestsValidationService;

  beforeEach(() => {
    repository = { findMany: jest.fn().mockResolvedValue([]) };

    service = new VacationRequestsValidationService(
      repository as unknown as VacationRequestsRepository,
      {} as VacationsUsageService,
      {} as ConfigService,
    );
  });

  describe('validateNoOverlap', () => {
    it('looks for pending or approved requests of the user that intersect the dates', async () => {
      await service.validateNoOverlap({
        userId: USER_ID,
        slackTeamId: SLACK_TEAM_ID,
        startDate: new Date('2026-02-02'),
        endDate: new Date('2026-02-06'),
      });

      expect(repository.findMany).toHaveBeenCalledWith({
        user_id: USER_ID,
        slack_team_id: SLACK_TEAM_ID,
        status: {
          operator: 'in',
          value: [
            VacationRequestStatus.Pending,
            VacationRequestStatus.Approved,
          ],
        },
        start_date: { operator: 'lte', value: '2026-02-06' },
        end_date: { operator: 'gte', value: '2026-02-02' },
      });
    });

    it('ignores the request being edited', async () => {
      await service.validateNoOverlap({
        userId: USER_ID,
        slackTeamId: SLACK_TEAM_ID,
        startDate: new Date('2026-02-02'),
        endDate: new Date('2026-02-06'),
        excludeRequestId: 'request-1',
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          id: { operator: 'neq', value: 'request-1' },
        }),
      );
    });

    it('rejects dates that overlap another request', async () => {
      repository.findMany.mockResolvedValue([
        { start_date: '2026-02-05', end_date: '2026-02-10' },
      ]);

      await expect(
        service.validateNoOverlap({
          userId: USER_ID,
          slackTeamId: SLACK_TEAM_ID,
          startDate: new Date('2026-02-02'),
          endDate: new Date('2026-02-06'),
        }),
      ).rejects.toThrow(
        new ValidationError(
          'These dates overlap with another vacation request (5–10 Feb 2026)',
        ),
      );
    });
  });

  describe('validateRequestLimits', () => {
    const limits: Record<string, number> = {
      [EnvironmentVariable.MaxRequestsPerUser]: 4,
      [EnvironmentVariable.MaxPendingRequestsPerUser]: 2,
    };

    const requests = (...statuses: VacationRequestStatus[]) =>
      statuses.map((status, index) => ({ id: `request-${index}`, status }));

    beforeEach(() => {
      service = new VacationRequestsValidationService(
        repository as unknown as VacationRequestsRepository,
        {} as VacationsUsageService,
        {
          getOrThrow: (name: string) => limits[name],
        } as unknown as ConfigService,
      );
    });

    it('counts all requests of the user in the workspace', async () => {
      repository.findMany.mockResolvedValue(
        requests(VacationRequestStatus.Approved, VacationRequestStatus.Pending),
      );

      await expect(
        service.validateRequestLimits(USER_ID, SLACK_TEAM_ID),
      ).resolves.toBe(undefined);
      expect(repository.findMany).toHaveBeenCalledWith({
        user_id: USER_ID,
        slack_team_id: SLACK_TEAM_ID,
      });
    });

    it('refuses a request over the limit of requests per user', async () => {
      repository.findMany.mockResolvedValue(
        requests(
          VacationRequestStatus.Approved,
          VacationRequestStatus.Rejected,
          VacationRequestStatus.Canceled,
          VacationRequestStatus.Approved,
        ),
      );

      await expect(
        service.validateRequestLimits(USER_ID, SLACK_TEAM_ID),
      ).rejects.toThrow(
        new ValidationError('Max vacation requests limit reached (4)'),
      );
    });

    it('refuses a request over the limit of pending requests', async () => {
      repository.findMany.mockResolvedValue(
        requests(VacationRequestStatus.Pending, VacationRequestStatus.Pending),
      );

      await expect(
        service.validateRequestLimits(USER_ID, SLACK_TEAM_ID),
      ).rejects.toThrow(
        new ValidationError('Max opened vacation requests limit reached (2)'),
      );
    });

    it('counts only pending requests against the pending limit', async () => {
      repository.findMany.mockResolvedValue(
        requests(VacationRequestStatus.Pending, VacationRequestStatus.Approved),
      );

      await expect(
        service.validateRequestLimits(USER_ID, SLACK_TEAM_ID),
      ).resolves.toBe(undefined);
    });
  });

  describe('checkDaysRequested', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-12-01T12:00:00Z') });
    });

    afterEach(() => jest.useRealTimers());

    const year = (
      start: string,
      end: string,
      available: number,
      {
        workingAvailable = available,
        bonusAvailable = 0,
        correction = null,
      }: {
        workingAvailable?: number;
        bonusAvailable?: number;
        correction?: IVacationLimits['correction'];
      } = {},
    ): IVacationPeriodUsageData => ({
      periodStart: new Date(start),
      periodEnd: new Date(end),
      limits: {
        vacationDays: 20,
        workingDays: 20,
        bonusDays: 3,
        carryoverDays: 0,
        carryoverWorkingDays: 0,
        daysTotal: 20,
        correction,
      },
      usage: {
        [VacationType.AnnualLeave]: {
          used: 20 - available,
          available,
          working_days_used: 20 - workingAvailable,
          working_days_available: workingAvailable,
        },
        [VacationType.BonusDay]: {
          used: 3 - bonusAvailable,
          available: bonusAvailable,
        },
        [VacationType.SickLeave]: { used: 0 },
        [VacationType.UnpaidLeave]: { used: 0 },
        [VacationType.Other]: { used: 0 },
      },
    });

    // Monday 2026-12-28 to Saturday 2027-01-02: four days (all working) in
    // 2026, two (one working) in 2027.
    const acrossNewYear = {
      startDate: new Date('2026-12-28'),
      endDate: new Date('2027-01-02'),
      workingDates: [
        '2026-12-28',
        '2026-12-29',
        '2026-12-30',
        '2026-12-31',
        '2027-01-01',
      ],
    };

    it("checks each year's part of the request against that year", () => {
      expect(() =>
        service.checkDaysRequested(acrossNewYear, VacationType.AnnualLeave, [
          year('2026-01-01', '2026-12-31', 4),
          year('2027-01-01', '2027-12-31', 2),
        ]),
      ).not.toThrow();
    });

    it('names the vacation year that has too few days left', () => {
      expect(() =>
        service.checkDaysRequested(acrossNewYear, VacationType.AnnualLeave, [
          year('2026-01-01', '2026-12-31', 4),
          year('2027-01-01', '2027-12-31', 1),
        ]),
      ).toThrow(
        new ValidationError(
          'Not enough vacation days in the vacation year from 1 Jan 2027. Requested: 2, available: 1',
        ),
      );
    });

    it('keeps the message short for the current year', () => {
      expect(() =>
        service.checkDaysRequested(acrossNewYear, VacationType.AnnualLeave, [
          year('2026-01-01', '2026-12-31', 3),
          year('2027-01-01', '2027-12-31', 20),
        ]),
      ).toThrow(
        new ValidationError(
          'Not enough vacation days. Requested: 4, available: 3',
        ),
      );
    });

    describe('in the year of a balance from a file', () => {
      // A balance left on Wednesday 2026-06-17: what was left before any
      // leave from that day on.
      const balance = (
        units: Partial<NonNullable<IVacationLimits['correction']>>,
      ) => ({
        balanceOn: '2026-06-17',
        days: null,
        workingDays: null,
        bonusDays: null,
        ...units,
      });
      // Monday to Friday, three of its days from the balance's day on.
      const acrossTheBalanceDay = {
        startDate: new Date('2026-06-15'),
        endDate: new Date('2026-06-19'),
        workingDates: [
          '2026-06-15',
          '2026-06-16',
          '2026-06-17',
          '2026-06-18',
          '2026-06-19',
        ],
      };

      it('takes only the days from the balance day on from a unit the file gave', () => {
        expect(() =>
          service.checkDaysRequested(
            acrossTheBalanceDay,
            VacationType.AnnualLeave,
            [
              year('2026-01-01', '2026-12-31', 3, {
                workingAvailable: 3,
                correction: balance({ days: -13, workingDays: -9 }),
              }),
            ],
          ),
        ).not.toThrow();
        expect(() =>
          service.checkDaysRequested(
            acrossTheBalanceDay,
            VacationType.AnnualLeave,
            [
              year('2026-01-01', '2026-12-31', 2, {
                workingAvailable: 20,
                correction: balance({ days: -14 }),
              }),
            ],
          ),
        ).toThrow(
          new ValidationError(
            'Not enough vacation days. Requested: 3, available: 2',
          ),
        );
      });

      it('takes nothing from a unit the file gave for a request before the balance day', () => {
        expect(() =>
          service.checkDaysRequested(
            {
              startDate: new Date('2026-04-06'),
              endDate: new Date('2026-04-10'),
              workingDates: [
                '2026-04-06',
                '2026-04-07',
                '2026-04-08',
                '2026-04-09',
                '2026-04-10',
              ],
            },
            VacationType.AnnualLeave,
            [
              year('2026-01-01', '2026-12-31', 0, {
                correction: balance({ days: -16, workingDays: -12 }),
              }),
            ],
          ),
        ).not.toThrow();
      });

      it('counts the whole request in a unit the file left empty', () => {
        expect(() =>
          service.checkDaysRequested(
            acrossTheBalanceDay,
            VacationType.AnnualLeave,
            [
              year('2026-01-01', '2026-12-31', 20, {
                workingAvailable: 4,
                correction: balance({ days: -13 }),
              }),
            ],
          ),
        ).toThrow(
          new ValidationError(
            'Not enough working days. Requested: 5, available: 4',
          ),
        );
      });

      it('takes bonus days from the balance day on when the file gave them', () => {
        expect(() =>
          service.checkDaysRequested(
            acrossTheBalanceDay,
            VacationType.BonusDay,
            [
              year('2026-01-01', '2026-12-31', 20, {
                bonusAvailable: 3,
                correction: balance({ bonusDays: 0 }),
              }),
            ],
          ),
        ).not.toThrow();
      });
    });
  });
});
