import { ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import TeamsService from 'src/teams/services/teams.service';
import { UsersService } from 'src/users/services/users.service';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import UserRole from 'src/common/enums/user-role.enum';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import { TransactionService } from 'src/database/transaction.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';

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
  let repository: Record<
    'findOne' | 'update' | 'create' | 'findMany' | 'createMany' | 'deleteMany',
    jest.Mock
  >;
  let validator: Record<
    | 'validateRequestLimits'
    | 'validateNoOverlap'
    | 'validateDaysRequested'
    | 'getUsage'
    | 'checkDaysRequested',
    jest.Mock
  >;
  let eventEmitter: { emit: jest.Mock };
  let usersService: { findOneWithValidation: jest.Mock };
  let teamsService: { findOneWithValidation: jest.Mock };
  let timeEntriesService: { deleteVacationTime: jest.Mock };
  let workflowService: { closeBeforeDelete: jest.Mock };
  let service: VacationRequestsService;
  // Which repository calls ran inside TransactionService.transaction().
  let inTransaction: boolean;
  const transactions = {
    transaction: async <T>(work: () => Promise<T>) => {
      inTransaction = true;

      try {
        return await work();
      } finally {
        inTransaction = false;
      }
    },
    lock: jest.fn(),
  };

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      update: jest.fn(),
      create: jest.fn().mockResolvedValue(buildRequest()),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
    };
    validator = {
      validateRequestLimits: jest.fn(),
      validateNoOverlap: jest.fn(),
      validateDaysRequested: jest.fn(),
      getUsage: jest.fn(),
      checkDaysRequested: jest.fn(),
    };
    eventEmitter = { emit: jest.fn() };
    usersService = { findOneWithValidation: jest.fn() };
    teamsService = {
      findOneWithValidation: jest
        .fn()
        .mockResolvedValue({ vacation_policy_id: null }),
    };
    timeEntriesService = {
      deleteVacationTime: jest
        .fn()
        .mockResolvedValue({ deleted: 0, billedDates: [] }),
    };
    workflowService = { closeBeforeDelete: jest.fn() };

    service = new VacationRequestsService(
      repository as unknown as VacationRequestsRepository,
      validator as unknown as VacationRequestsValidationService,
      {
        calculate: jest.fn().mockResolvedValue(5),
      } as unknown as VacationDaysCalculationService,
      teamsService as unknown as TeamsService,
      eventEmitter as unknown as EventEmitter2,
      usersService as unknown as UsersService,
      transactions as unknown as TransactionService,
      timeEntriesService as unknown as TimeEntriesService,
      workflowService as unknown as RequestWorkflowService,
    );
    inTransaction = false;
  });

  describe('overlap check', () => {
    const createParams = {
      userId: requester.id,
      teamId: null,
      startDate: new Date('2026-02-02'),
      endDate: new Date('2026-02-06'),
      type: VacationType.AnnualLeave,
    };

    it('checks a new pending request against existing ones', async () => {
      await service.create(
        { ...createParams, status: VacationRequestStatus.Pending },
        requester,
      );

      expect(validator.validateNoOverlap).toHaveBeenCalledWith({
        userId: requester.id,
        slackTeamId: SLACK_TEAM_ID,
        startDate: createParams.startDate,
        endDate: createParams.endDate,
      });
    });

    it('skips the check for a request HR records as rejected', async () => {
      usersService.findOneWithValidation.mockResolvedValue(requester);

      await service.create(
        { ...createParams, status: VacationRequestStatus.Rejected },
        { ...requester, id: 'hr-1', role: UserRole.HR },
      );

      expect(validator.validateNoOverlap).not.toHaveBeenCalled();
    });

    it('checks new dates on edit, ignoring the edited request itself', async () => {
      repository.findOne.mockResolvedValue(buildRequest());
      repository.update.mockResolvedValue(buildRequest());

      await service.update(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { endDate: new Date('2026-02-09') },
        requester,
      );

      expect(validator.validateNoOverlap).toHaveBeenCalledWith({
        userId: requester.id,
        slackTeamId: SLACK_TEAM_ID,
        startDate: new Date('2026-02-02'),
        endDate: new Date('2026-02-09'),
        excludeRequestId: 'request-1',
      });
    });

    it('does not check when only the comment changes', async () => {
      repository.findOne.mockResolvedValue(buildRequest());
      repository.update.mockResolvedValue(buildRequest());

      await service.update(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { userComment: 'Updated' },
        requester,
      );

      expect(validator.validateNoOverlap).not.toHaveBeenCalled();
    });
  });

  describe('a request HR or an admin makes for someone else', () => {
    const admin: IUserViewModel = {
      ...requester,
      id: 'admin-1',
      slack_id: 'U_ADMIN',
      role: UserRole.Admin,
    };

    it("checks the requester's balance, not the admin's", async () => {
      usersService.findOneWithValidation.mockResolvedValue(requester);

      await service.create(
        {
          userId: requester.id,
          teamId: null,
          startDate: new Date('2026-02-02'),
          endDate: new Date('2026-02-06'),
          type: VacationType.AnnualLeave,
          status: VacationRequestStatus.Pending,
        },
        admin,
      );

      expect(usersService.findOneWithValidation).toHaveBeenCalledWith({
        id: requester.id,
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(validator.validateDaysRequested).toHaveBeenCalledWith(
        expect.anything(),
        VacationType.AnnualLeave,
        requester,
      );
    });

    it("checks the requester's balance when the admin changes the dates", async () => {
      usersService.findOneWithValidation.mockResolvedValue(requester);
      repository.findOne.mockResolvedValue(buildRequest());
      repository.update.mockResolvedValue(buildRequest());

      const usage = { limits: null };
      validator.getUsage.mockResolvedValue(usage);

      await service.update(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { endDate: new Date('2026-02-09') },
        admin,
      );

      // An edit reads the balance beside the working days, then checks it.
      expect(validator.getUsage).toHaveBeenCalledWith(requester);
      expect(validator.checkDaysRequested).toHaveBeenCalledWith(
        expect.anything(),
        VacationType.AnnualLeave,
        usage,
      );
    });

    it("puts an edited request in its person's team", async () => {
      const colleague = { ...requester, id: 'user-2', team_id: 'team-2' };
      usersService.findOneWithValidation.mockResolvedValue(colleague);
      repository.findOne.mockResolvedValue(buildRequest());
      repository.update.mockResolvedValue(buildRequest());

      await service.update(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { userId: 'user-2', inOwnersTeam: true },
        admin,
      );

      expect(usersService.findOneWithValidation).toHaveBeenCalledWith({
        id: 'user-2',
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(teamsService.findOneWithValidation).toHaveBeenCalledWith({
        id: 'team-2',
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(repository.update).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ user_id: 'user-2', team_id: 'team-2' }),
      );
    });

    it('needs no lookup when users request for themselves', async () => {
      await service.create(
        {
          userId: requester.id,
          teamId: null,
          startDate: new Date('2026-02-02'),
          endDate: new Date('2026-02-06'),
          type: VacationType.AnnualLeave,
          status: VacationRequestStatus.Pending,
        },
        requester,
      );

      expect(usersService.findOneWithValidation).not.toHaveBeenCalled();
      expect(validator.validateDaysRequested).toHaveBeenCalledWith(
        expect.anything(),
        VacationType.AnnualLeave,
        requester,
      );
    });
  });

  // Rules the Slack forms check too, here for every other way in.
  describe('what a request may say', () => {
    const ownRequest = {
      userId: requester.id,
      teamId: null,
      startDate: new Date('2026-02-02'),
      endDate: new Date('2026-02-06'),
      type: VacationType.AnnualLeave,
      status: VacationRequestStatus.Pending,
    };

    const createError = async (
      params: Partial<typeof ownRequest> & { userComment?: string | null },
      actor: IUserViewModel = requester,
    ) => {
      const error: unknown = await service
        .create({ ...ownRequest, ...params }, actor)
        .then(() => null)
        .catch((caught: unknown) => caught);

      expect(repository.create).not.toHaveBeenCalled();

      return error;
    };

    it('refuses an end date before the start', async () => {
      const error = await createError({
        startDate: new Date('2026-02-06'),
        endDate: new Date('2026-02-02'),
      });

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'dates' });
    });

    it('refuses a type that is not a leave type', async () => {
      const error = await createError({ type: 'holiday' as VacationType });

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'type' });
    });

    it('refuses a comment over 200 characters', async () => {
      const error = await createError({ userComment: 'x'.repeat(201) });

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'comment' });
    });

    it('asks for a comment with the type Other', async () => {
      const error = await createError({
        type: VacationType.Other,
        userComment: '   ',
      });

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'comment' });
    });

    it('lets a member request only for themselves', async () => {
      const error = await createError({ userId: 'someone-else' });

      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('lets a member create only a pending request', async () => {
      const error = await createError({
        status: VacationRequestStatus.Approved,
      });

      expect(error).toBeInstanceOf(ForbiddenException);
    });

    it('lets HR create an approved request for someone else', async () => {
      const hr = { ...requester, id: 'hr-1', role: UserRole.HR };
      usersService.findOneWithValidation.mockResolvedValue(requester);

      await service.create(
        { ...ownRequest, status: VacationRequestStatus.Approved },
        hr,
      );

      expect(repository.create).toHaveBeenCalled();
    });

    it('refuses an edit that puts the end before the start', async () => {
      repository.findOne.mockResolvedValue(buildRequest());

      const error: unknown = await service
        .update(
          { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
          { endDate: new Date('2026-02-01') },
          requester,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'dates' });
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('cancels a request whose old comment would not pass today', async () => {
      repository.findOne.mockResolvedValue(
        buildRequest({ type: VacationType.Other, user_comment: null }),
      );
      repository.update.mockResolvedValue(buildRequest());

      await service.cancel('request-1', requester);

      expect(repository.update).toHaveBeenCalled();
    });
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

  // Time logged from an approved vacation goes when the vacation changes.
  describe('the logged time', () => {
    const hr: IUserViewModel = { ...requester, id: 'hr-1', role: UserRole.HR };
    const approved = buildRequest({ status: VacationRequestStatus.Approved });

    beforeEach(() => {
      repository.findOne.mockResolvedValue(approved);
      timeEntriesService.deleteVacationTime.mockImplementation(() => {
        expect(inTransaction).toBe(true);

        return Promise.resolve({ deleted: 3, billedDates: ['2026-02-04'] });
      });
    });

    it.each([
      ['the days', { end_date: '2026-02-09' }],
      ['the status', { status: VacationRequestStatus.Rejected }],
      ['the type', { type: VacationType.SickLeave }],
      ['the person', { user_id: 'user-2' }],
    ])(
      'is removed with an edit of %s, in its transaction',
      async (_change, changed) => {
        repository.update.mockImplementation(() => {
          expect(inTransaction).toBe(true);

          return Promise.resolve({ ...approved, ...changed });
        });

        const result = await service.update(
          { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
          {},
          hr,
        );

        expect(transactions.lock).toHaveBeenCalledWith('time-off:request-1');
        expect(timeEntriesService.deleteVacationTime).toHaveBeenCalledWith(
          'request-1',
          SLACK_TEAM_ID,
          hr,
        );
        expect(result).toEqual({
          request: { ...approved, ...changed },
          billedDates: ['2026-02-04'],
        });
        // Whose time it was hears what went.
        expect(eventEmitter.emit).toHaveBeenCalledWith(
          VacationRequestEvent.Updated,
          expect.objectContaining({
            removedTime: { deleted: 3, billedDates: ['2026-02-04'] },
          }),
        );
      },
    );

    it('stays with an edit of the comment', async () => {
      repository.update.mockResolvedValue({
        ...approved,
        user_comment: 'Family trip',
      });

      const result = await service.update(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { userComment: 'Family trip' },
        hr,
      );

      expect(timeEntriesService.deleteVacationTime).not.toHaveBeenCalled();
      expect(result.billedDates).toEqual([]);
    });

    // HR's form read the request while it was pending; the workflow approved
    // it before the lock, and the requester logged it. An edit of the comment
    // changes nothing of that time.
    it('compares with the request as it is under the lock', async () => {
      repository.findOne
        .mockResolvedValueOnce(
          buildRequest({ status: VacationRequestStatus.Pending }),
        )
        .mockResolvedValueOnce(approved);
      repository.update.mockResolvedValue({
        ...approved,
        user_comment: 'Family trip',
      });

      await service.update(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { userComment: 'Family trip' },
        hr,
      );

      expect(repository.findOne).toHaveBeenCalledTimes(2);
      expect(timeEntriesService.deleteVacationTime).not.toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        VacationRequestEvent.Updated,
        expect.objectContaining({ previous: approved }),
      );
    });

    it('is removed before the request is deleted, in one transaction', async () => {
      const calls: string[] = [];
      timeEntriesService.deleteVacationTime.mockImplementation(() => {
        calls.push(`time, in a transaction: ${inTransaction}`);

        return Promise.resolve({ deleted: 3, billedDates: ['2026-02-04'] });
      });
      repository.deleteMany.mockImplementation(() => {
        calls.push(`request, in a transaction: ${inTransaction}`);
      });

      const result = await service.delete(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        hr,
      );

      expect(calls).toEqual([
        'time, in a transaction: true',
        'request, in a transaction: true',
      ]);
      expect(result).toEqual({
        request: approved,
        billedDates: ['2026-02-04'],
      });
    });
  });

  describe('delete', () => {
    const admin: IUserViewModel = {
      ...requester,
      id: 'admin-1',
      slack_id: 'U_ADMIN',
      role: UserRole.Admin,
    };

    // The steps go with the request (ON DELETE CASCADE): closing them and
    // deleting it either both happen or neither does.
    it("closes the request's approvals in the transaction that deletes it", async () => {
      const calls: string[] = [];
      repository.findOne.mockResolvedValue(buildRequest());
      workflowService.closeBeforeDelete.mockImplementation(() => {
        calls.push(`close the approvals, in a transaction: ${inTransaction}`);
      });
      repository.deleteMany.mockImplementation(() => {
        calls.push(`delete, in a transaction: ${inTransaction}`);
      });

      await service.delete(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        admin,
      );

      expect(workflowService.closeBeforeDelete).toHaveBeenCalledWith(
        'request-1',
        admin,
      );
      expect(calls).toEqual([
        'close the approvals, in a transaction: true',
        'delete, in a transaction: true',
      ]);
    });
  });

  describe("replacing a user's vacations (CSV import)", () => {
    const vacations = [
      {
        userId: requester.id,
        teamId: null,
        startDate: new Date('2026-03-02'),
        endDate: new Date('2026-03-06'),
        type: VacationType.AnnualLeave,
        status: VacationRequestStatus.Approved,
      },
    ];

    // The old vacations out and the new ones in are one transaction
    // (test/integration covers a refusal).
    it("replaces the user's vacations in one transaction", async () => {
      const calls: string[] = [];
      repository.deleteMany.mockImplementation(() => {
        calls.push(`delete, in a transaction: ${inTransaction}`);
      });
      repository.createMany.mockImplementation(() => {
        calls.push(`insert, in a transaction: ${inTransaction}`);

        return Promise.resolve([]);
      });

      await service.replaceUserVacations(requester, vacations, requester);

      expect(calls).toEqual([
        'delete, in a transaction: true',
        'insert, in a transaction: true',
      ]);
      expect(repository.deleteMany).toHaveBeenCalledWith({
        slack_team_id: SLACK_TEAM_ID,
        user_id: requester.id,
      });
      expect(repository.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          slack_team_id: SLACK_TEAM_ID,
          user_id: requester.id,
          start_date: '2026-03-02T00:00:00.000Z',
          end_date: '2026-03-06T00:00:00.000Z',
          days: 5,
          type: VacationType.AnnualLeave,
          status: VacationRequestStatus.Approved,
          created_by: requester.id,
        }),
      ]);
    });

    // A refused import rolls back the closed steps and the jobs with it.
    it("closes the approvals of the user's pending requests in the same transaction", async () => {
      const calls: string[] = [];
      repository.findMany.mockResolvedValue([
        buildRequest({ id: 'pending-1' }),
      ]);
      workflowService.closeBeforeDelete.mockImplementation(() => {
        calls.push(`close the approvals, in a transaction: ${inTransaction}`);
      });
      repository.deleteMany.mockImplementation(() => {
        calls.push(`delete, in a transaction: ${inTransaction}`);
      });

      await service.replaceUserVacations(requester, vacations, requester);

      expect(repository.findMany).toHaveBeenCalledWith({
        user_id: requester.id,
        slack_team_id: SLACK_TEAM_ID,
        status: { operator: 'in', value: [VacationRequestStatus.Pending] },
      });
      expect(workflowService.closeBeforeDelete).toHaveBeenCalledWith(
        'pending-1',
        requester,
      );
      expect(calls).toEqual([
        'close the approvals, in a transaction: true',
        'delete, in a transaction: true',
      ]);
    });
  });
});
