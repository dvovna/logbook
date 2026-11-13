import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { ValidationError } from '@common/errors/validation.error';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReimbursementsRepository } from '@modules/receipts/repositories/reimbursements.repository';
import { IReimbursementViewModel } from '@modules/receipts/types/reimbursement.interface';
import { ReimbursementsService } from '@modules/receipts/services/reimbursements.service';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const reimbursement = (
  id: string,
  name: string,
  archivedAt: string | null = null,
): IReimbursementViewModel => ({
  id,
  slackTeamId: SLACK_TEAM_ID,
  name,
  dueDay: 4,
  limitCents: null,
  archivedAt,
  createdAt: '2026-11-01T00:00:00.000000+00:00',
});

const INPUT = { name: 'Gym', dueDay: 4, limitCents: 5000 };

describe('ReimbursementsService', () => {
  let repository: Record<
    'findMany' | 'findOne' | 'create' | 'update',
    jest.Mock
  >;
  let transactions: Record<'transaction' | 'lock', jest.Mock>;
  let service: ReimbursementsService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn().mockResolvedValue(reimbursement('r1', 'Gym')),
      update: jest.fn().mockResolvedValue(reimbursement('r1', 'Gym')),
    };
    transactions = {
      transaction: jest.fn((work: () => Promise<unknown>) => work()),
      lock: jest.fn(),
    };
    service = new ReimbursementsService(
      repository as unknown as ReimbursementsRepository,
      transactions as unknown as TransactionService,
    );
  });

  it.each([UserRole.Member, UserRole.Manager, UserRole.HR])(
    'refuses %s',
    async (role) => {
      const actor = userWith(role);

      await expect(service.create(INPUT, actor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.update('r1', INPUT, actor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.archive('r1', actor)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(repository.create).not.toHaveBeenCalled();
    },
  );

  it.each([UserRole.Admin, UserRole.Finance])(
    'lets %s create',
    async (role) => {
      await service.create(INPUT, userWith(role));

      expect(transactions.lock).toHaveBeenCalled();
      expect(repository.create).toHaveBeenCalledWith({
        slack_team_id: SLACK_TEAM_ID,
        name: 'Gym',
        due_day: 4,
        limit_cents: 5000,
      });
    },
  );

  it('refuses a name an active reimbursement uses, at the name field', async () => {
    repository.findMany.mockResolvedValue([reimbursement('r2', 'Gym')]);

    await expect(
      service.create(INPUT, userWith(UserRole.Admin)),
    ).rejects.toMatchObject({
      constructor: DuplicatedRecordError,
      field: 'name',
    });
  });

  it('compares names ignoring case on create', async () => {
    repository.findMany.mockResolvedValue([reimbursement('r2', 'Gym')]);

    await expect(
      service.create({ ...INPUT, name: 'gym' }, userWith(UserRole.Admin)),
    ).rejects.toMatchObject({
      constructor: DuplicatedRecordError,
      field: 'name',
    });
  });

  it('compares names ignoring case on update', async () => {
    repository.findMany.mockResolvedValue([
      reimbursement('r1', 'Lunch'),
      reimbursement('r2', 'Gym'),
    ]);

    await expect(
      service.update('r1', { ...INPUT, name: 'GYM' }, userWith(UserRole.Admin)),
    ).rejects.toMatchObject({
      constructor: DuplicatedRecordError,
      field: 'name',
    });
  });

  it('reads only active reimbursements, so an archived name may be reused', async () => {
    await service.create(INPUT, userWith(UserRole.Admin));

    expect(repository.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        archived_at: { operator: 'is', value: null },
      }),
      expect.anything(),
    );
    expect(repository.create).toHaveBeenCalled();
  });

  it('refuses the 11th active reimbursement', async () => {
    repository.findMany.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) =>
        reimbursement(`r${index}`, `Other ${index}`),
      ),
    );

    await expect(
      service.create(INPUT, userWith(UserRole.Admin)),
    ).rejects.toBeInstanceOf(MaxItemsCountReachedError);
  });

  it.each([
    [{ ...INPUT, dueDay: 0 }, 'dueDay'],
    [{ ...INPUT, dueDay: 29 }, 'dueDay'],
    [{ ...INPUT, limitCents: 0 }, 'limit'],
    [{ ...INPUT, name: '  ' }, 'name'],
  ])('refuses %j', async (input, field) => {
    await expect(
      service.create(input, userWith(UserRole.Admin)),
    ).rejects.toMatchObject({ constructor: ValidationError, field });
  });

  it('keeps its own name on update', async () => {
    repository.findMany.mockResolvedValue([reimbursement('r1', 'Gym')]);

    await service.update('r1', INPUT, userWith(UserRole.Admin));

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'r1', slack_team_id: SLACK_TEAM_ID },
      { name: 'Gym', due_day: 4, limit_cents: 5000 },
    );
  });

  it('archives with the time', async () => {
    repository.findOne.mockResolvedValue(reimbursement('r1', 'Gym'));

    await service.archive('r1', userWith(UserRole.Finance));

    expect(repository.update).toHaveBeenCalledWith(
      { id: 'r1', slack_team_id: SLACK_TEAM_ID },
      { archived_at: expect.any(String) },
    );
  });
});
