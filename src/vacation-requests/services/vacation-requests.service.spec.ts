import { ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import TeamsService from 'src/teams/services/teams.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import UserRole from 'src/common/enums/user-role.enum';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import { ValidationError } from 'src/common/errors/validation.error';

const SLACK_TEAM_ID = 'slack-team-1';

const requester: IUserViewModel = {
  id: 'user-1',
  email: 'requester@example.com',
  name: 'Requester',
  role: UserRole.Member,
  is_active: true,
  team_id: null,
  slack_team_id: SLACK_TEAM_ID,
  slack_id: 'U_REQUESTER',
  created_at: '2026-01-01T00:00:00Z',
};

const buildRequest = (
  overrides: Partial<IVacationRequestViewModel> = {},
): IVacationRequestViewModel => ({
  id: 'request-1',
  start_date: '2026-02-02',
  end_date: '2026-02-06',
  days: 5,
  working_days: 5,
  type: VacationType.AnnualLeave,
  status: VacationRequestStatus.Pending,
  team: null,
  user: {
    id: requester.id,
    name: requester.name,
    email: requester.email,
    slack_id: requester.slack_id,
  },
  team_id: null,
  user_id: requester.id,
  slack_team_id: SLACK_TEAM_ID,
  created_at: null,
  updated_at: null,
  updated_by: null,
  created_by: null,
  ...overrides,
});

describe('VacationRequestsService', () => {
  let repository: Record<'findOne' | 'update', jest.Mock>;
  let eventEmitter: { emit: jest.Mock };
  let service: VacationRequestsService;

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      update: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };

    service = new VacationRequestsService(
      repository as unknown as VacationRequestsRepository,
      {
        validateDaysRequested: jest.fn(),
      } as unknown as VacationRequestsValidationService,
      {
        calculate: jest.fn().mockResolvedValue(5),
      } as unknown as VacationDaysCalculationService,
      {} as TeamsService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  describe('cancel', () => {
    it("cancels the requester's own pending request", async () => {
      const canceled = buildRequest({ status: VacationRequestStatus.Canceled });
      repository.findOne.mockResolvedValue(buildRequest());
      repository.update.mockResolvedValue(canceled);

      const result = await service.cancel('request-1', requester);

      expect(repository.update).toHaveBeenCalledWith(
        { id: 'request-1', slack_team_id: SLACK_TEAM_ID },
        expect.objectContaining({
          status: VacationRequestStatus.Canceled,
          updated_by: requester.id,
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        VacationRequestEvent.Updated,
        expect.objectContaining({ request: canceled }),
      );
      expect(result).toBe(canceled);
    });

    it("refuses to cancel someone else's request", async () => {
      repository.findOne.mockResolvedValue(buildRequest({ user_id: 'user-2' }));

      await expect(service.cancel('request-1', requester)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it.each([
      VacationRequestStatus.Approved,
      VacationRequestStatus.Rejected,
      VacationRequestStatus.Canceled,
    ])('refuses to cancel a request that is already %s', async (status) => {
      repository.findOne.mockResolvedValue(buildRequest({ status }));

      await expect(service.cancel('request-1', requester)).rejects.toThrow(
        ValidationError,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
