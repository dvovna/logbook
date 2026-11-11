import { billingSnapshotsLock } from 'src/database/advisory-locks';
import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TransactionService } from 'src/database/transaction.service';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import {
  IBillingSnapshot,
  IBillingSnapshotViewModel,
} from 'src/billing/types/billing-snapshot.types';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const PERIOD = {
  clientId: 'acme',
  fromDate: '2026-10-01',
  toDate: '2026-10-31',
};

const NOTHING_LEFT = new ValidationError(
  'No approved time of Acme in 1–31 Oct 2026 is left outside snapshots.',
);

describe('BillingSnapshotsService', () => {
  let client: { id: string; name: string } | null;
  let snapshotsRepository: Record<string, jest.Mock>;
  let entriesRepository: Record<string, jest.Mock>;
  let transactions: { transaction: jest.Mock; lock: jest.Mock };
  let service: BillingSnapshotsService;

  beforeEach(() => {
    client = { id: 'acme', name: 'Acme' };
    snapshotsRepository = {
      createFromUnbilled: jest.fn(),
      findOne: jest.fn(),
      search: jest.fn(),
      markInvoiced: jest.fn(),
      deleteOne: jest.fn(),
    };
    entriesRepository = {
      hasUnbilled: jest.fn(async () => true),
      unbilledTotals: jest.fn(),
      statsBySnapshot: jest.fn(async () => new Map()),
    };
    transactions = {
      transaction: jest.fn((work: () => Promise<unknown>) => work()),
      lock: jest.fn(),
    };

    service = new BillingSnapshotsService(
      snapshotsRepository as unknown as BillingSnapshotsRepository,
      entriesRepository as unknown as BillingSnapshotEntriesRepository,
      transactions as unknown as TransactionService,
      {
        findOne: jest.fn(async () => client),
      } as unknown as ClientsService,
      {
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      } as unknown as SlackTeamsService,
    );
  });

  describe('create', () => {
    it("locks the period's time in one statement, one snapshot of the workspace at a time", async () => {
      const made = { id: 'snapshot-1', entryCount: 4 } as IBillingSnapshot;

      transactions.lock.mockImplementation(async () => {
        expect(snapshotsRepository.createFromUnbilled).not.toHaveBeenCalled();
      });
      snapshotsRepository.createFromUnbilled.mockResolvedValue(made);

      expect(
        await service.create({ user: userWith(UserRole.Finance), ...PERIOD }),
      ).toBe(made);
      expect(transactions.transaction).toHaveBeenCalledTimes(1);
      expect(transactions.lock).toHaveBeenCalledWith(
        billingSnapshotsLock(SLACK_TEAM_ID),
      );
      expect(snapshotsRepository.createFromUnbilled).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        clientId: 'acme',
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
        currency: 'EUR',
        createdBy: 'actor',
      });
    });

    it('refuses a period with nothing left outside snapshots', async () => {
      snapshotsRepository.createFromUnbilled.mockResolvedValue(null);

      await expect(
        service.create({ user: userWith(UserRole.Admin), ...PERIOD }),
      ).rejects.toThrow(NOTHING_LEFT);
    });

    it("refuses a client that isn't the workspace's", async () => {
      client = null;

      await expect(
        service.create({ user: userWith(UserRole.Admin), ...PERIOD }),
      ).rejects.toThrow(new ValidationError('Client not found.'));
      expect(transactions.transaction).not.toHaveBeenCalled();
      expect(snapshotsRepository.createFromUnbilled).not.toHaveBeenCalled();
    });

    it('refuses a period of more than a year', async () => {
      await expect(
        service.create({
          user: userWith(UserRole.Admin),
          ...PERIOD,
          fromDate: '2025-01-01',
        }),
      ).rejects.toThrow(ValidationError);
      expect(snapshotsRepository.createFromUnbilled).not.toHaveBeenCalled();
    });

    it.each([UserRole.HR, UserRole.Manager, UserRole.Member])(
      'is not made by a %s',
      async (role) => {
        await expect(
          service.create({ user: userWith(role), ...PERIOD }),
        ).rejects.toThrow(ForbiddenException);
        expect(snapshotsRepository.createFromUnbilled).not.toHaveBeenCalled();
      },
    );
  });

  describe('assertCanCreate', () => {
    it("passes when the client's period has time to lock", async () => {
      await service.assertCanCreate({
        user: userWith(UserRole.Admin),
        ...PERIOD,
      });

      expect(entriesRepository.hasUnbilled).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        ...PERIOD,
      });
      expect(transactions.transaction).not.toHaveBeenCalled();
    });

    it('refuses a period with nothing left outside snapshots', async () => {
      entriesRepository.hasUnbilled.mockResolvedValue(false);

      await expect(
        service.assertCanCreate({ user: userWith(UserRole.Admin), ...PERIOD }),
      ).rejects.toThrow(NOTHING_LEFT);
    });

    it("refuses a client that isn't the workspace's", async () => {
      client = null;

      await expect(
        service.assertCanCreate({ user: userWith(UserRole.Admin), ...PERIOD }),
      ).rejects.toThrow(new ValidationError('Client not found.'));
    });

    it('reads nothing for a member', async () => {
      await expect(
        service.assertCanCreate({
          user: userWith(UserRole.Member),
          ...PERIOD,
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(entriesRepository.hasUnbilled).not.toHaveBeenCalled();
    });
  });

  it('previews without locking or writing anything', async () => {
    entriesRepository.unbilledTotals.mockResolvedValue({
      entryCount: 1,
      totalMinutes: 90,
      billableMinutes: 90,
      amountCents: 12000,
      unratedMinutes: 0,
    });

    expect(
      await service.preview({ user: userWith(UserRole.Admin), ...PERIOD }),
    ).toEqual({
      clientName: 'Acme',
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
      currency: 'EUR',
      entryCount: 1,
      totalMinutes: 90,
      billableMinutes: 90,
      amountCents: 12000,
      unratedMinutes: 0,
    });
    expect(entriesRepository.unbilledTotals).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      ...PERIOD,
    });
    expect(transactions.transaction).not.toHaveBeenCalled();
    expect(snapshotsRepository.createFromUnbilled).not.toHaveBeenCalled();
  });

  describe('markInvoiced', () => {
    const stored = (fields: Partial<IBillingSnapshotViewModel> = {}) =>
      ({
        id: 'snapshot-1',
        invoiced_at: null,
        ...fields,
      }) as IBillingSnapshotViewModel;

    it('marks a snapshot once', async () => {
      snapshotsRepository.findOne.mockResolvedValue(stored());
      snapshotsRepository.markInvoiced.mockResolvedValue(true);

      await service.markInvoiced('snapshot-1', userWith(UserRole.Finance));

      expect(snapshotsRepository.findOne).toHaveBeenCalledWith({
        id: 'snapshot-1',
        slack_team_id: SLACK_TEAM_ID,
      });
      expect(snapshotsRepository.markInvoiced).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        'snapshot-1',
        'actor',
      );
    });

    it('says when it is marked already', async () => {
      snapshotsRepository.findOne.mockResolvedValue(
        stored({ invoiced_at: '2026-11-01T10:00:00.000000+00:00' }),
      );
      snapshotsRepository.markInvoiced.mockResolvedValue(false);

      await expect(
        service.markInvoiced('snapshot-1', userWith(UserRole.Admin)),
      ).rejects.toThrow(
        new ValidationError('This snapshot is already marked invoiced.'),
      );
    });

    it("refuses a snapshot that isn't the workspace's", async () => {
      snapshotsRepository.findOne.mockResolvedValue(null);

      await expect(
        service.markInvoiced('elsewhere', userWith(UserRole.Admin)),
      ).rejects.toThrow(new ValidationError('This snapshot no longer exists.'));
      expect(snapshotsRepository.markInvoiced).not.toHaveBeenCalled();
    });

    it('is not done by a manager', async () => {
      await expect(
        service.markInvoiced('snapshot-1', userWith(UserRole.Manager)),
      ).rejects.toThrow(ForbiddenException);
      expect(snapshotsRepository.findOne).not.toHaveBeenCalled();
    });
  });

  describe('markNotInvoiced', () => {
    it('takes the mark off an invoiced snapshot', async () => {
      snapshotsRepository.findOne.mockResolvedValue({
        id: 'snapshot-1',
        invoiced_at: '2026-11-01T10:00:00.000000+00:00',
      });
      snapshotsRepository.unmarkInvoiced = jest.fn().mockResolvedValue(true);

      await service.markNotInvoiced('snapshot-1', userWith(UserRole.Finance));

      expect(snapshotsRepository.unmarkInvoiced).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        'snapshot-1',
      );
    });

    it("says when it isn't marked", async () => {
      snapshotsRepository.findOne.mockResolvedValue({
        id: 'snapshot-1',
        invoiced_at: null,
      });
      snapshotsRepository.unmarkInvoiced = jest.fn().mockResolvedValue(false);

      await expect(
        service.markNotInvoiced('snapshot-1', userWith(UserRole.Admin)),
      ).rejects.toThrow(
        new ValidationError("This snapshot isn't marked invoiced."),
      );
    });

    it('is not done by a manager', async () => {
      await expect(
        service.markNotInvoiced('snapshot-1', userWith(UserRole.Manager)),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  it("lists one client's snapshots of the workspace", async () => {
    snapshotsRepository.search.mockResolvedValue({
      items: [],
      totalCount: 0,
      page: 1,
      pageSize: 10,
    });

    await service.search(userWith(UserRole.Finance), {
      pageSize: 10,
      clientId: 'acme',
    });

    expect(snapshotsRepository.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: { slack_team_id: SLACK_TEAM_ID, client_id: 'acme' },
      }),
    );
  });

  describe('unlock', () => {
    it('deletes the snapshot, an invoiced one too', async () => {
      snapshotsRepository.findOne.mockResolvedValue({
        id: 'snapshot-1',
        invoiced_at: '2026-11-01T10:00:00.000000+00:00',
      });
      snapshotsRepository.deleteOne.mockResolvedValue(true);

      await service.unlock('snapshot-1', userWith(UserRole.Admin));

      expect(snapshotsRepository.deleteOne).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        'snapshot-1',
      );
    });

    it.each([UserRole.HR, UserRole.Manager])(
      'is not done by %s',
      async (role) => {
        await expect(
          service.unlock('snapshot-1', userWith(role)),
        ).rejects.toThrow(ForbiddenException);
        expect(snapshotsRepository.deleteOne).not.toHaveBeenCalled();
      },
    );
  });
});
