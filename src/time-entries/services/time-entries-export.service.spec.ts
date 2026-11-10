import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';
import { TimeReportService } from 'src/time-entries/services/time-report.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';

const PERIOD = { fromDate: '2026-11-01', toDate: '2026-11-30' };

const userWith = (role: UserRole) =>
  ({ id: 'viewer', role, slack_team_id: 'slack-team-1' }) as IUserViewModel;

const entry = (fields: Partial<ITimeEntryViewModel>) =>
  ({
    id: 'e1',
    work_date: '2026-11-03',
    project_id: 'web',
    project: { id: 'web', name: 'Website' },
    user_id: 'mia',
    user: { id: 'mia', name: 'Mia Member', email: 'mia@acme.test' },
    team: { id: 'backend', name: 'Backend' },
    client: null,
    description: 'API review',
    minutes: 150,
    billable: true,
    status: TimeEntryStatus.Approved,
    created_at: '2026-11-03T10:00:00.000000+00:00',
    ...fields,
  }) as ITimeEntryViewModel;

// The rows of the file, without its byte order mark and the last line end.
const rowsOf = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n$/, '')
    .split('\r\n');

describe('TimeEntriesExportService', () => {
  let entries: ITimeEntryViewModel[];
  let rates: Map<string, IProjectRates>;
  let projectRatesService: { findRates: jest.Mock };
  let service: TimeEntriesExportService;

  beforeEach(() => {
    entries = [];
    rates = new Map([
      [
        'web',
        {
          hourlyRate: 120,
          personRates: [{ userId: 'ann', name: 'Ann', hourlyRate: 150.5 }],
        },
      ],
    ]);
    projectRatesService = { findRates: jest.fn(async () => rates) };
    service = new TimeEntriesExportService(
      {
        findFilteredEntries: jest.fn(async () => ({
          scope: { kind: 'workspace' },
          entries,
          applied: {},
        })),
        clientsByProject: jest.fn(
          async () =>
            new Map([
              ['web', { id: 'acme', name: 'Acme, Inc.' }],
              ['int', null],
            ]),
        ),
      } as unknown as TimeReportService,
      projectRatesService as unknown as ProjectRatesService,
      {
        getCurrency: jest.fn().mockResolvedValue('USD'),
      } as unknown as SlackTeamsService,
    );
  });

  it('writes one line per entry, by date and person, with rates for Admin and Finance', async () => {
    entries.push(
      entry({ id: 'e2', work_date: '2026-11-04', minutes: 15 }),
      entry({
        id: 'e3',
        user_id: 'ann',
        user: {
          id: 'ann',
          name: 'Ann Admin',
          email: 'ann@acme.test',
          slack_id: 'UANN',
        },
        minutes: 30,
        status: TimeEntryStatus.Draft,
        description: '=cmd|"/c calc"',
      }),
      entry({
        id: 'e4',
        project_id: 'int',
        project: { id: 'int', name: 'Internal' },
        team: null,
        billable: false,
        description: '',
      }),
      entry({}),
    );

    const csv = await service.getCsv({
      user: userWith(UserRole.Finance),
      ...PERIOD,
    });

    expect(csv).toMatchObject({
      filename: 'time-report-2026-11-01-to-2026-11-30.csv',
      scope: 'workspace',
      entryCount: 4,
      minutes: 345,
    });
    expect(csv.content.startsWith('\uFEFF')).toBe(true);
    expect(rowsOf(csv.content)).toEqual([
      'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status,Rate,Amount,Currency',
      `2026-11-03,Ann Admin,ann@acme.test,Backend,"Acme, Inc.",Website,"'=cmd|""/c calc""",0.50,yes,draft,150.50,75.25,USD`,
      '2026-11-03,Mia Member,mia@acme.test,,,Internal,,2.50,no,approved,,,USD',
      '2026-11-03,Mia Member,mia@acme.test,Backend,"Acme, Inc.",Website,API review,2.50,yes,approved,120.00,300.00,USD',
      '2026-11-04,Mia Member,mia@acme.test,Backend,"Acme, Inc.",Website,API review,0.25,yes,approved,120.00,30.00,USD',
    ]);
  });

  it.each([UserRole.HR, UserRole.Manager])(
    'leaves rates and amounts out for %s',
    async (role) => {
      entries.push(entry({}));

      const csv = await service.getCsv({
        user: userWith(role),
        ...PERIOD,
      });

      expect(rowsOf(csv.content)).toEqual([
        'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status',
        '2026-11-03,Mia Member,mia@acme.test,Backend,"Acme, Inc.",Website,API review,2.50,yes,approved',
      ]);
      expect(projectRatesService.findRates).not.toHaveBeenCalled();
    },
  );

  it('writes only the header for a period without time', async () => {
    const csv = await service.getCsv({
      user: userWith(UserRole.Member),
      ...PERIOD,
    });

    expect(rowsOf(csv.content)).toEqual([
      'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status',
    ]);
    expect(csv.entryCount).toBe(0);
  });

  it('refuses a period longer than a year', async () => {
    await expect(
      service.getCsv({
        user: userWith(UserRole.Admin),
        fromDate: '2025-01-01',
        toDate: '2026-11-30',
      }),
    ).rejects.toThrow(ValidationError);
  });
});
