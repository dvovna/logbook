import { billingSnapshotsLock } from 'src/database/advisory-locks';
import { ForbiddenException } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TransactionService } from 'src/database/transaction.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import {
  IBillingSnapshotViewModel,
  IUnbilledEntry,
} from 'src/billing/types/billing-snapshot.types';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const entry = (
  id: string,
  projectId: string,
  userId: string,
  minutes: number,
  billable = true,
): IUnbilledEntry => ({
  id,
  project_id: projectId,
  user_id: userId,
  minutes,
  billable,
});

const PERIOD = {
  clientId: 'acme',
  fromDate: '2026-10-01',
  toDate: '2026-10-31',
};

describe('BillingSnapshotsService', () => {
  let entries: IUnbilledEntry[];
  let rates: Map<string, IProjectRates>;
  let client: { id: string; name: string } | null;
  let snapshotsRepository: Record<string, jest.Mock>;
  let entriesRepository: Record<string, jest.Mock>;
  let transactions: { transaction: jest.Mock; lock: jest.Mock };
  let service: BillingSnapshotsService;

  beforeEach(() => {
    entries = [];
    rates = new Map();
    client = { id: 'acme', name: 'Acme' };
    snapshotsRepository = {
      create: jest.fn(async (row) => ({
        ...row,
        id: 'snapshot-1',
        total_amount_cents: Math.round(row.total_amount * 100),
      })),
      findOne: jest.fn(),
      search: jest.fn(),
      markInvoiced: jest.fn(),
      deleteOne: jest.fn(),
    };
    entriesRepository = {
      findUnbilledApproved: jest.fn(async () => entries),
      insertLines: jest.fn(),
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
        findMany: jest.fn().mockResolvedValue([{ id: 'web' }, { id: 'app' }]),
      } as unknown as ProjectsService,
      {
        findRates: jest.fn(async () => rates),
      } as unknown as ProjectRatesService,
      {
        getCurrency: jest.fn().mockResolvedValue('EUR'),
      } as unknown as SlackTeamsService,
    );
  });

  describe('create', () => {
    it("freezes each entry's rate and amount, and the totals", async () => {
      rates.set('web', {
        hourlyRate: 100,
        personRates: [{ userId: 'ann', name: 'Ann', hourlyRate: 150 }],
      });
      rates.set('app', { hourlyRate: null, personRates: [] });
      entries.push(
        entry('e1', 'web', 'mia', 90),
        entry('e2', 'web', 'ann', 30),
        entry('e3', 'web', 'mia', 60, false),
        entry('e4', 'app', 'mia', 45),
      );

      const snapshot = await service.create({
        user: userWith(UserRole.Finance),
        ...PERIOD,
      });

      expect(transactions.lock).toHaveBeenCalledWith(
        billingSnapshotsLock(SLACK_TEAM_ID),
      );
      expect(entriesRepository.findUnbilledApproved).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        projectIds: ['web', 'app'],
        fromDate: '2026-10-01',
        toDate: '2026-10-31',
        lock: true,
      });
      expect(snapshotsRepository.create).toHaveBeenCalledWith({
        slack_team_id: SLACK_TEAM_ID,
        client_id: 'acme',
        period_start: '2026-10-01',
        period_end: '2026-10-31',
        currency: 'EUR',
        total_minutes: 225,
        billable_minutes: 165,
        // 1.5h at 100 and 0.5h at Ann's own 150; App has no rate.
        total_amount: 225,
        created_at: expect.any(String),
        created_by: 'actor',
      });
      expect(entriesRepository.insertLines).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        'snapshot-1',
        [
          {
            timeEntryId: 'e1',
            minutes: 90,
            billable: true,
            hourlyRate: 100,
            amountCents: 15000,
          },
          {
            timeEntryId: 'e2',
            minutes: 30,
            billable: true,
            hourlyRate: 150,
            amountCents: 7500,
          },
          {
            timeEntryId: 'e3',
            minutes: 60,
            billable: false,
            hourlyRate: 100,
            amountCents: null,
          },
          {
            timeEntryId: 'e4',
            minutes: 45,
            billable: true,
            hourlyRate: null,
            amountCents: null,
          },
        ],
      );
      expect(snapshot).toMatchObject({ entryCount: 4, unratedMinutes: 45 });
    });

    it('rounds each entry to the cent, so the lines add up to the total', async () => {
      rates.set('web', { hourlyRate: 100.01, personRates: [] });
      entries.push(
        entry('e1', 'web', 'mia', 15),
        entry('e2', 'web', 'mia', 15),
      );

      await service.create({ user: userWith(UserRole.Admin), ...PERIOD });

      // 25.0025 each, rounded to 25.00.
      expect(snapshotsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ total_amount: 50 }),
      );
    });

    it('refuses a period with nothing left outside snapshots', async () => {
      await expect(
        service.create({ user: userWith(UserRole.Admin), ...PERIOD }),
      ).rejects.toThrow(
        new ValidationError(
          'No approved time of Acme in 1–31 Oct 2026 is left outside snapshots.',
        ),
      );
      expect(snapshotsRepository.create).not.toHaveBeenCalled();
    });

    it("refuses a client that isn't the workspace's", async () => {
      client = null;
      entries.push(entry('e1', 'web', 'mia', 60));

      await expect(
        service.create({ user: userWith(UserRole.Admin), ...PERIOD }),
      ).rejects.toThrow(new ValidationError('Client not found.'));
      expect(entriesRepository.findUnbilledApproved).not.toHaveBeenCalled();
    });

    it('refuses a period of more than a year', async () => {
      await expect(
        service.create({
          user: userWith(UserRole.Admin),
          ...PERIOD,
          fromDate: '2025-01-01',
        }),
      ).rejects.toThrow(ValidationError);
    });

    it.each([UserRole.HR, UserRole.Manager, UserRole.Member])(
      'is not made by a %s',
      async (role) => {
        entries.push(entry('e1', 'web', 'mia', 60));

        await expect(
          service.create({ user: userWith(role), ...PERIOD }),
        ).rejects.toThrow(ForbiddenException);
        expect(entriesRepository.findUnbilledApproved).not.toHaveBeenCalled();
        expect(snapshotsRepository.create).not.toHaveBeenCalled();
      },
    );
  });

  it('previews without locking or writing anything', async () => {
    rates.set('web', { hourlyRate: 80, personRates: [] });
    entries.push(entry('e1', 'web', 'mia', 90));

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
    expect(entriesRepository.findUnbilledApproved).toHaveBeenCalledWith(
      expect.objectContaining({ lock: false }),
    );
    expect(transactions.transaction).not.toHaveBeenCalled();
    expect(snapshotsRepository.create).not.toHaveBeenCalled();
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
