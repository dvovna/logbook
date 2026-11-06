import { ConfigService } from '@nestjs/config';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { ValidationError } from 'src/common/errors/validation.error';

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
          'These dates overlap with another vacation request (2026-02-05 – 2026-02-10)',
        ),
      );
    });
  });
});
