import { ForbiddenException } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import UserRole from '@common/enums/user-role.enum';
import ClientsService from '@modules/clients/services/clients.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { BillingSnapshotsRepository } from 'src/billing/repositories/billing-snapshots.repository';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import { UninvoicedReportService } from 'src/billing/services/uninvoiced-report.service';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: 'slack-team-1' }) as IUserViewModel;

describe('UninvoicedReportService', () => {
  const unbilledByClient = jest.fn();
  const notInvoicedByClient = jest.fn();
  const service = new UninvoicedReportService(
    { unbilledByClient } as unknown as BillingSnapshotEntriesRepository,
    { notInvoicedByClient } as unknown as BillingSnapshotsRepository,
    {
      findMany: jest.fn().mockResolvedValue([
        { id: 'acme', name: 'Acme' },
        { id: 'globex', name: 'Globex' },
        { id: 'initech', name: 'Initech' },
      ]),
    } as unknown as ClientsService,
    {
      getCurrency: jest.fn().mockResolvedValue('USD'),
    } as unknown as SlackTeamsService,
  );

  beforeEach(() => {
    unbilledByClient.mockReset();
    notInvoicedByClient.mockReset();
  });

  it('puts time in no snapshot and snapshots not invoiced side by side', async () => {
    unbilledByClient.mockResolvedValue([
      {
        clientId: 'globex',
        minutes: 60,
        amountCents: 8000,
        unratedMinutes: 0,
        since: '2026-09-02',
      },
      {
        clientId: 'acme',
        minutes: 120,
        amountCents: 10000,
        unratedMinutes: 30,
        since: '2026-10-01',
      },
    ]);
    notInvoicedByClient.mockResolvedValue([
      {
        clientId: 'initech',
        snapshotCount: 2,
        billableMinutes: 240,
        amountCents: 40000,
      },
      {
        clientId: 'acme',
        snapshotCount: 1,
        billableMinutes: 60,
        amountCents: 5000,
      },
    ]);

    const report = await service.getReport(userWith(UserRole.Finance));

    expect(unbilledByClient).toHaveBeenCalledWith('slack-team-1', {});
    expect(report).toEqual({
      currency: 'USD',
      rows: [
        {
          clientName: 'Acme',
          minutes: 120,
          amountCents: 10000,
          unratedMinutes: 30,
          since: '2026-10-01',
          snapshotMinutes: 60,
          snapshotAmountCents: 5000,
          snapshotCount: 1,
        },
        {
          clientName: 'Globex',
          minutes: 60,
          amountCents: 8000,
          unratedMinutes: 0,
          since: '2026-09-02',
          snapshotMinutes: 0,
          snapshotAmountCents: 0,
          snapshotCount: 0,
        },
        {
          clientName: 'Initech',
          minutes: 0,
          amountCents: 0,
          unratedMinutes: 0,
          since: null,
          snapshotMinutes: 240,
          snapshotAmountCents: 40000,
          snapshotCount: 2,
        },
      ],
      total: {
        minutes: 180,
        amountCents: 18000,
        unratedMinutes: 30,
        snapshotMinutes: 300,
        snapshotAmountCents: 45000,
        snapshotCount: 3,
      },
    });
  });

  it('narrows both parts to the period, open on either side', async () => {
    unbilledByClient.mockResolvedValue([]);
    notInvoicedByClient.mockResolvedValue([]);

    const report = await service.getReport(userWith(UserRole.Admin), {
      fromDate: '2026-06-01',
    });

    expect(unbilledByClient).toHaveBeenCalledWith('slack-team-1', {
      fromDate: '2026-06-01',
    });
    expect(notInvoicedByClient).toHaveBeenCalledWith('slack-team-1', {
      fromDate: '2026-06-01',
    });
    expect(report).toMatchObject({ fromDate: '2026-06-01', rows: [] });
  });

  it.each([
    [{ fromDate: '2026-06-10', toDate: '2026-06-01' }],
    [{ toDate: '2026-02-30' }],
  ])('refuses the period %j', async (period) => {
    await expect(
      service.getReport(userWith(UserRole.Admin), period),
    ).rejects.toThrow(ValidationError);
    expect(unbilledByClient).not.toHaveBeenCalled();
  });

  it.each([UserRole.HR, UserRole.Manager, UserRole.Member])(
    'is not shown to a %s',
    async (role) => {
      await expect(service.getReport(userWith(role))).rejects.toThrow(
        ForbiddenException,
      );
      expect(unbilledByClient).not.toHaveBeenCalled();
    },
  );
});
