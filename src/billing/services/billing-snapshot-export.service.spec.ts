import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { BillingSnapshotEntriesRepository } from 'src/billing/repositories/billing-snapshot-entries.repository';
import { BillingSnapshotExportService } from 'src/billing/services/billing-snapshot-export.service';
import {
  IBillingSnapshot,
  ISnapshotLine,
} from 'src/billing/types/billing-snapshot.types';

const user = {
  id: 'actor',
  role: UserRole.HR,
  slack_team_id: 'slack-team-1',
} as IUserViewModel;

const line = (fields: Partial<ISnapshotLine>): ISnapshotLine => ({
  workDate: '2026-10-05',
  personName: 'Mia Member',
  email: 'mia@example.com',
  teamName: 'Dev',
  projectName: 'Website',
  description: null,
  minutes: 60,
  billable: true,
  hourlyRate: 100,
  amountCents: 10000,
  createdAt: '2026-10-05T10:00:00.000000+00:00',
  ...fields,
});

describe('BillingSnapshotExportService', () => {
  const findOne = jest.fn();
  const findLines = jest.fn();
  const service = new BillingSnapshotExportService(
    { findOne } as unknown as BillingSnapshotsService,
    { findLines } as unknown as BillingSnapshotEntriesRepository,
  );

  beforeEach(() => {
    findOne.mockResolvedValue({
      id: 'snapshot-1',
      client: { id: 'acme', name: 'Acme Corp.' },
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      currency: 'EUR',
    } as IBillingSnapshot);
  });

  it('lists the entries with the rates and amounts the snapshot froze', async () => {
    findLines.mockResolvedValue([
      line({
        workDate: '2026-10-06',
        description: '=HYPERLINK("http://evil")',
      }),
      line({
        personName: 'Ann Admin',
        email: 'ann@example.com',
        teamName: null,
        minutes: 90,
        hourlyRate: 150.5,
        amountCents: 22575,
      }),
      line({ billable: false, amountCents: null, description: 'Call, notes' }),
      line({
        projectName: 'App',
        minutes: 15,
        hourlyRate: null,
        amountCents: null,
      }),
    ]);

    const csv = await service.getCsv('snapshot-1', user);

    expect(findOne).toHaveBeenCalledWith('snapshot-1', user);
    expect(findLines).toHaveBeenCalledWith('slack-team-1', 'snapshot-1');
    expect(csv.filename).toBe('billing-acme-corp-2026-10-01-to-2026-10-31.csv');
    expect(csv.content).toBe(
      '\uFEFF' +
        [
          'Date,Person,Email,Team,Project,Description,Hours,Billable,Rate,Amount,Currency',
          '2026-10-05,Ann Admin,ann@example.com,,Website,,1.50,yes,150.50,225.75,EUR',
          '2026-10-05,Mia Member,mia@example.com,Dev,App,,0.25,yes,,,EUR',
          '2026-10-05,Mia Member,mia@example.com,Dev,Website,"Call, notes",1.00,no,100.00,,EUR',
          `2026-10-06,Mia Member,mia@example.com,Dev,Website,"'=HYPERLINK(""http://evil"")",1.00,yes,100.00,100.00,EUR`,
        ].join('\r\n') +
        '\r\n',
    );
  });

  it('names the file even when the client has no usable name', async () => {
    findOne.mockResolvedValue({
      id: 'snapshot-1',
      client: { id: 'x', name: 'Дом' },
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      currency: 'EUR',
    } as IBillingSnapshot);
    findLines.mockResolvedValue([]);

    const csv = await service.getCsv('snapshot-1', user);

    expect(csv.filename).toBe('billing-client-2026-10-01-to-2026-10-31.csv');
  });
});
