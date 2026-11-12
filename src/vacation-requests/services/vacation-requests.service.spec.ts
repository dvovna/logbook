import { vacationRequestLock } from 'src/database/advisory-locks';
import { ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { VacationRequestsRepository } from 'src/vacation-requests/repositories/vacation-requests.repository';
import { VacationRequestsValidationService } from 'src/vacation-requests/services/vacation-requests-validation.service';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
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
import HolidaysService from 'src/holidays/services/holidays.service';

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
  leave_file_upload_id: null,
  ...overrides,
});

describe('VacationRequestsService', () => {
  let repository: Record<
    | 'findOne'
    | 'update'
    | 'updateMany'
    | 'create'
    | 'findMany'
    | 'createMany'
    | 'deleteMany'
    | 'deleteUnchanged',
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
  let eventEmitter: { emit: jest.Mock; emitAsync: jest.Mock };
  // Whether each emitAsync came inside the transaction.
  let emittedInTransaction: boolean[];
  let usersService: {
    findOneWithValidation: jest.Mock;
    setContractStartDates: jest.Mock;
  };
  let teamRules: { forTeam: jest.Mock; forWorkspace: jest.Mock };
  let workflowService: {
    closeBeforeDelete: jest.Mock;
    closeManyBeforeDelete: jest.Mock;
  };
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
    assertHolds: jest.fn(),
  };

  beforeEach(() => {
    repository = {
      findOne: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn().mockResolvedValue(buildRequest()),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      deleteUnchanged: jest.fn(),
    };
    validator = {
      validateRequestLimits: jest.fn(),
      validateNoOverlap: jest.fn(),
      validateDaysRequested: jest.fn(),
      getUsage: jest.fn(),
      checkDaysRequested: jest.fn(),
    };
    emittedInTransaction = [];
    eventEmitter = {
      emit: jest.fn(),
      emitAsync: jest.fn(() => {
        emittedInTransaction.push(inTransaction);

        return Promise.resolve([]);
      }),
    };
    usersService = {
      findOneWithValidation: jest.fn(),
      setContractStartDates: jest.fn(),
    };
    teamRules = {
      forTeam: jest.fn().mockResolvedValue({ vacationPolicyId: null }),
      forWorkspace: jest.fn().mockResolvedValue({
        companyRules: { vacation_policy_id: 'policy-1' },
        teams: [],
      }),
    };
    workflowService = {
      closeBeforeDelete: jest.fn(),
      closeManyBeforeDelete: jest.fn(),
    };
    transactions.lock.mockReset();
    transactions.assertHolds.mockReset();

    service = new VacationRequestsService(
      repository as unknown as VacationRequestsRepository,
      validator as unknown as VacationRequestsValidationService,
      {
        calculate: jest.fn().mockResolvedValue(5),
        // March 4 is a holiday of the company rules' policy.
        holidayDatesByPolicy: jest
          .fn()
          .mockResolvedValue(new Map([['policy-1', new Set(['2026-03-04'])]])),
        workingDatesWithout: (start: Date, end: Date, holidays: Set<string>) =>
          new VacationDaysCalculationService(
            {} as HolidaysService,
          ).workingDatesWithout(start, end, holidays),
        workingDates: jest
          .fn()
          .mockResolvedValue([
            '2026-02-02',
            '2026-02-03',
            '2026-02-04',
            '2026-02-05',
            '2026-02-06',
          ]),
      } as unknown as VacationDaysCalculationService,
      teamRules as unknown as TeamRulesService,
      eventEmitter as unknown as EventEmitter2,
      usersService as unknown as UsersService,
      transactions as unknown as TransactionService,
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
      expect(validator.validateDaysRequested).not.toHaveBeenCalled();
    });

    it('checks new dates on edit, ignoring the edited request itself', async () => {
      repository.findOne.mockResolvedValue(buildRequest());

      await service.checkUpdate(
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

      await service.checkUpdate(
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

      const usage = { limits: null };
      validator.getUsage.mockResolvedValue(usage);

      await service.checkUpdate(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { endDate: new Date('2026-02-09') },
        admin,
      );

      // An edit reads the balance beside the working days, without the
      // request itself, then checks it.
      expect(validator.getUsage).toHaveBeenCalledWith(
        requester,
        expect.objectContaining({ endDate: new Date('2026-02-09') }),
        { excludeRequestId: 'request-1' },
      );
      expect(validator.checkDaysRequested).toHaveBeenCalledWith(
        expect.objectContaining({ workingDates: expect.any(Array) }),
        VacationType.AnnualLeave,
        usage,
      );
    });

    it('checks the balance when an edit makes sick leave annual leave', async () => {
      usersService.findOneWithValidation.mockResolvedValue(requester);
      repository.findOne.mockResolvedValue(
        buildRequest({ type: VacationType.SickLeave }),
      );
      validator.getUsage.mockResolvedValue([]);

      await service.checkUpdate(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { type: VacationType.AnnualLeave },
        admin,
      );

      expect(validator.checkDaysRequested).toHaveBeenCalledWith(
        expect.anything(),
        VacationType.AnnualLeave,
        [],
      );
    });

    it('checks the balance when an edit brings back a rejected request', async () => {
      usersService.findOneWithValidation.mockResolvedValue(requester);
      repository.findOne.mockResolvedValue(
        buildRequest({ status: VacationRequestStatus.Rejected }),
      );

      await service.checkUpdate(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { status: VacationRequestStatus.Approved },
        admin,
      );

      expect(validator.getUsage).toHaveBeenCalled();
    });

    it('leaves the balance alone when an edit changes only the comment', async () => {
      repository.findOne.mockResolvedValue(buildRequest());

      await service.checkUpdate(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { userComment: 'Back on Monday' },
        requester,
      );

      expect(validator.getUsage).not.toHaveBeenCalled();
      expect(validator.checkDaysRequested).not.toHaveBeenCalled();
    });

    it("puts an edited request in its person's team", async () => {
      const colleague = { ...requester, id: 'user-2', team_id: 'team-2' };
      usersService.findOneWithValidation.mockResolvedValue(colleague);
      repository.findOne.mockResolvedValue(buildRequest());
      repository.update.mockResolvedValue(buildRequest());

      await service.applyUpdate(
        await service.checkUpdate(
          { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
          { userId: 'user-2' },
          admin,
        ),
        admin,
      );

      expect(usersService.findOneWithValidation).toHaveBeenCalledWith({
        id: 'user-2',
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(teamRules.forTeam).toHaveBeenCalledWith('team-2', SLACK_TEAM_ID);
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

    // The listeners save the jobs that follow it (its approval) with it.
    it('tells of the new request inside its transaction', async () => {
      const created = buildRequest();
      repository.create.mockResolvedValue(created);

      await expect(service.create(ownRequest, requester)).resolves.toBe(
        created,
      );

      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationRequestEvent.Created,
        expect.objectContaining({ request: created, user: requester }),
      );
      expect(emittedInTransaction).toEqual([true]);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('refuses an edit that puts the end before the start', async () => {
      repository.findOne.mockResolvedValue(buildRequest());

      const error: unknown = await service
        .checkUpdate(
          { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
          { endDate: new Date('2026-02-01') },
          requester,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'dates' });
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
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationRequestEvent.Updated,
        expect.objectContaining({ request: canceled }),
      );
      // Its listeners close the approvers' steps with it.
      expect(emittedInTransaction).toEqual([true]);
      expect(result).toBe(canceled);
    });

    it("refuses to cancel someone else's request", async () => {
      repository.findOne.mockResolvedValue(buildRequest({ user_id: 'user-2' }));

      await expect(service.cancel('request-1', requester)).rejects.toThrow(
        ForbiddenException,
      );
      expect(repository.update).not.toHaveBeenCalled();
    });

    it('refuses the cancel when the request was approved since its check', async () => {
      repository.findOne
        .mockResolvedValueOnce(buildRequest())
        .mockResolvedValue(
          buildRequest({ status: VacationRequestStatus.Approved }),
        );

      await expect(service.cancel('request-1', requester)).rejects.toThrow(
        'Only vacation requests waiting for approval can be canceled',
      );
      expect(transactions.lock).toHaveBeenCalled();
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

  describe('finishing a pending request', () => {
    it('sets the outcome and tells of it inside one transaction', async () => {
      const approved = buildRequest({ status: VacationRequestStatus.Approved });
      repository.updateMany.mockResolvedValue([approved]);

      await expect(
        service.finishPending(
          { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
          VacationRequestStatus.Approved,
          requester,
        ),
      ).resolves.toBe(approved);

      expect(repository.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ status: VacationRequestStatus.Pending }),
        expect.objectContaining({ status: VacationRequestStatus.Approved }),
      );
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationRequestEvent.Updated,
        expect.objectContaining({ request: approved }),
      );
      expect(emittedInTransaction).toEqual([true]);
    });

    it('tells nothing when the request no longer waits', async () => {
      repository.updateMany.mockResolvedValue([]);

      await expect(
        service.finishPending(
          { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
          VacationRequestStatus.Rejected,
          requester,
        ),
      ).resolves.toBeNull();

      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('applying a checked edit', () => {
    const hr: IUserViewModel = { ...requester, id: 'hr-1', role: UserRole.HR };
    const approved = buildRequest({ status: VacationRequestStatus.Approved });

    // HR's form read the request while it was pending; the workflow approved
    // it before the lock. The caller compares with the request as it is now.
    it('reads the request again under its lock', async () => {
      const calls: string[] = [];
      repository.findOne
        .mockResolvedValueOnce(
          buildRequest({ status: VacationRequestStatus.Pending }),
        )
        .mockImplementationOnce(() => {
          calls.push('read');

          return Promise.resolve(approved);
        });
      transactions.assertHolds.mockImplementation(() => {
        calls.push('lock held');
      });
      repository.update.mockImplementation(() => {
        calls.push('write');

        return Promise.resolve({ ...approved, user_comment: 'Family trip' });
      });

      const update = await service.checkUpdate(
        { id: 'request-1', slackTeamId: SLACK_TEAM_ID },
        { userComment: 'Family trip' },
        hr,
      );

      expect(calls).toEqual([]);

      const result = await service.applyUpdate(update, hr);

      expect(transactions.assertHolds).toHaveBeenCalledWith(
        vacationRequestLock('request-1'),
      );
      expect(calls).toEqual(['lock held', 'read', 'write']);
      expect(result).toEqual({
        previous: approved,
        request: { ...approved, user_comment: 'Family trip' },
      });
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('applyDelete', () => {
    const admin: IUserViewModel = {
      ...requester,
      id: 'admin-1',
      slack_id: 'U_ADMIN',
      role: UserRole.Admin,
    };

    // The steps go with the request (ON DELETE CASCADE): closing them and
    // deleting it either both happen or neither does.
    it("closes the request's approvals, then deletes it, under its lock", async () => {
      const calls: string[] = [];
      transactions.assertHolds.mockImplementation(() => {
        calls.push('lock held');
      });
      workflowService.closeBeforeDelete.mockImplementation(() => {
        calls.push('close the approvals');
      });
      repository.deleteMany.mockImplementation(() => {
        calls.push('delete');
      });

      await service.applyDelete(buildRequest(), admin);

      expect(transactions.assertHolds).toHaveBeenCalledWith(
        vacationRequestLock('request-1'),
      );
      expect(workflowService.closeBeforeDelete).toHaveBeenCalledWith(
        'request-1',
        admin,
      );
      expect(repository.deleteMany).toHaveBeenCalledWith({
        id: 'request-1',
        slack_team_id: SLACK_TEAM_ID,
      });
      expect(calls).toEqual(['lock held', 'close the approvals', 'delete']);
    });
  });

  describe('adding the leaves of a history file', () => {
    const leave = (
      fields: Partial<Parameters<typeof service.addImported>[0][number]> = {},
    ) => ({
      userId: requester.id,
      teamId: null as string | null,
      type: VacationType.AnnualLeave,
      startDate: '2026-03-02',
      endDate: '2026-03-06',
      comment: null as string | null,
      ...fields,
    });

    it('inserts them approved and marked with the upload, a few thousand at a time in one transaction, and tells nobody', async () => {
      const inserts: string[] = [];
      repository.createMany.mockImplementation((rows: unknown[]) => {
        inserts.push(`${rows.length} rows, in a transaction: ${inTransaction}`);

        return Promise.resolve(rows.map(() => buildRequest()));
      });
      teamRules.forWorkspace.mockResolvedValue({
        companyRules: { vacation_policy_id: 'policy-1' },
        // A team of its own rules without a policy: no holidays.
        teams: [{ team: { id: 'team-1' }, vacationPolicyId: null }],
      });
      const leaves = [
        ...Array.from({ length: 2000 }, () => leave()),
        leave({
          teamId: 'team-1',
          type: VacationType.SickLeave,
          startDate: '2026-03-03',
          endDate: '2026-03-04',
          comment: 'Agreed by email',
        }),
      ];

      const created = await service.addImported(leaves, requester, 'upload-1');

      expect(created).toHaveLength(2001);
      expect(inserts).toEqual([
        '2000 rows, in a transaction: true',
        '1 rows, in a transaction: true',
      ]);
      expect(teamRules.forWorkspace).toHaveBeenCalledTimes(1);
      const [[first], [second]] = repository.createMany.mock.calls as [
        unknown[],
      ][];
      const row = {
        slack_team_id: SLACK_TEAM_ID,
        user_id: requester.id,
        status: VacationRequestStatus.Approved,
        leave_file_upload_id: 'upload-1',
        created_by: requester.id,
        updated_by: requester.id,
        created_at: expect.any(String),
        updated_at: expect.any(String),
      };
      // March 4 is a holiday of the company rules' policy.
      expect(first[0]).toEqual({
        ...row,
        team_id: null,
        start_date: '2026-03-02',
        end_date: '2026-03-06',
        days: 5,
        working_days: 4,
        type: VacationType.AnnualLeave,
        user_comment: null,
      });
      expect(second).toEqual([
        {
          ...row,
          team_id: 'team-1',
          start_date: '2026-03-03',
          end_date: '2026-03-04',
          days: 2,
          working_days: 2,
          type: VacationType.SickLeave,
          user_comment: 'Agreed by email',
        },
      ]);
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(workflowService.closeManyBeforeDelete).not.toHaveBeenCalled();
    });

    it('reads and writes nothing without leaves', async () => {
      await expect(
        service.addImported([], requester, 'upload-1'),
      ).resolves.toEqual([]);

      expect(teamRules.forWorkspace).not.toHaveBeenCalled();
      expect(repository.createMany).not.toHaveBeenCalled();
    });
  });

  describe('deleting the leaves of a history file', () => {
    it('deletes the ones still as the upload left them, in the workspace, and returns their IDs', async () => {
      const requests = [{ id: 'r1', updatedAt: '2026-06-17T09:00:00.000001Z' }];

      repository.deleteUnchanged.mockResolvedValue(['r1']);

      await expect(
        service.deleteImported(requests, 'upload-1', SLACK_TEAM_ID),
      ).resolves.toEqual(['r1']);
      expect(repository.deleteUnchanged).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        'upload-1',
        requests,
      );
    });
  });
});
