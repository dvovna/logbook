import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import { TimeEntriesExportService } from 'src/time-entries/services/time-entries-export.service';
import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import {
  ITimeReport,
  ITimeReportCsvRow,
} from 'src/time-entries/types/time-report.types';
import { TimeScope } from 'src/time-entries/types/time-scope.types';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';
const PERIOD = { fromDate: '2026-11-01', toDate: '2026-11-30' };

const userWith = (role: UserRole) =>
  ({ id: 'viewer', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const reportOf = (entryCount: number, fields: Partial<ITimeReport> = {}) =>
  ({
    groupBy: TimeReportGrouping.Project,
    ...PERIOD,
    scope: 'workspace',
    filters: {},
    entryCount,
    ...fields,
  }) as ITimeReport;

const line = (fields: Partial<ITimeReportCsvRow>): ITimeReportCsvRow => ({
  id: 'e1',
  work_date: '2026-11-03',
  created_at: '2026-11-03T10:00:00.000000+00:00',
  person: 'Mia Member',
  email: 'mia@acme.test',
  team: 'Backend',
  client: 'Acme, Inc.',
  project: 'Website',
  description: 'API review',
  minutes: 150,
  billable: true,
  status: TimeEntryStatus.Approved,
  hourly_rate: 120,
  ...fields,
});

// The rows of the file, without its byte order mark and the last line end.
const rowsOf = (content: string) =>
  content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n$/, '')
    .split('\r\n');

describe('TimeEntriesExportService', () => {
  let pages: ITimeReportCsvRow[][];
  let scope: TimeScope;
  let timeEntriesService: { findReportCsvPage: jest.Mock };
  let service: TimeEntriesExportService;

  const build = (limits = { pageSize: 2, maxEntries: 5 }) =>
    new TimeEntriesExportService(
      {
        scopeOf: jest.fn(async () => scope),
      } as unknown as TimeEntriesScopeService,
      timeEntriesService as unknown as TimeEntriesService,
      {
        getCurrency: jest.fn().mockResolvedValue('USD'),
      } as unknown as SlackTeamsService,
      limits,
    );

  beforeEach(() => {
    pages = [];
    scope = { kind: 'workspace' };
    timeEntriesService = {
      findReportCsvPage: jest.fn(async () => pages.shift() ?? []),
    };
    service = build();
  });

  const csvOf = (role: UserRole, entryCount: number, filters = {}) =>
    service.getCsv({
      user: userWith(role),
      report: reportOf(entryCount),
      filters,
    });

  it('writes one line per entry, a page at a time, with rates for Admin and Finance', async () => {
    pages.push(
      [
        line({
          id: 'e3',
          person: 'Ann Admin',
          email: 'ann@acme.test',
          minutes: 30,
          status: TimeEntryStatus.Draft,
          description: '=cmd|"/c calc"',
          hourly_rate: 150.5,
        }),
        line({
          id: 'e4',
          team: null,
          client: null,
          project: 'Internal',
          billable: false,
          description: null,
          hourly_rate: null,
        }),
      ],
      [line({}), line({ id: 'e2', work_date: '2026-11-04', minutes: 15 })],
      [],
    );

    const csv = await csvOf(UserRole.Finance, 4);

    expect(csv).toMatchObject({
      status: 'ready',
      filename: 'time-report-2026-11-01-to-2026-11-30.csv',
      entryCount: 4,
      minutes: 345,
    });

    const { content } = csv as { content: string };

    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(rowsOf(content)).toEqual([
      'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status,Rate,Amount,Currency',
      `2026-11-03,Ann Admin,ann@acme.test,Backend,"Acme, Inc.",Website,"'=cmd|""/c calc""",0.50,yes,draft,150.50,75.25,USD`,
      '2026-11-03,Mia Member,mia@acme.test,,,Internal,,2.50,no,approved,,,USD',
      '2026-11-03,Mia Member,mia@acme.test,Backend,"Acme, Inc.",Website,API review,2.50,yes,approved,120.00,300.00,USD',
      '2026-11-04,Mia Member,mia@acme.test,Backend,"Acme, Inc.",Website,API review,0.25,yes,approved,120.00,30.00,USD',
    ]);
    // Each page goes on after the last line of the one before.
    expect(
      timeEntriesService.findReportCsvPage.mock.calls.map(([, , page]) => page),
    ).toEqual([
      { after: undefined, limit: 2, withRates: true },
      {
        after: {
          work_date: '2026-11-03',
          person: 'Mia Member',
          project: 'Internal',
          created_at: '2026-11-03T10:00:00.000000+00:00',
          id: 'e4',
        },
        limit: 2,
        withRates: true,
      },
      {
        after: expect.objectContaining({ id: 'e2' }),
        limit: 2,
        withRates: true,
      },
    ]);
  });

  it.each([
    [UserRole.HR, { kind: 'workspace' }, {}],
    [
      UserRole.Manager,
      { kind: 'teams', teamIds: ['backend'] },
      { userId: 'viewer', teamIds: ['backend'] },
    ],
  ] as const)(
    'leaves rates and amounts out for %s, and reads within their scope',
    async (role, theirScope, scopeFilter) => {
      scope = theirScope as TimeScope;
      pages.push([line({ hourly_rate: null })]);

      const csv = await csvOf(role, 1, { projectId: 'web' });

      expect(rowsOf((csv as { content: string }).content)).toEqual([
        'Date,Person,Email,Team,Client,Project,Description,Hours,Billable,Status',
        '2026-11-03,Mia Member,mia@acme.test,Backend,"Acme, Inc.",Website,API review,2.50,yes,approved',
      ]);
      expect(timeEntriesService.findReportCsvPage).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        {
          dateFrom: PERIOD.fromDate,
          dateTo: PERIOD.toDate,
          scope: scopeFilter,
          filters: { projectId: 'web' },
        },
        { after: undefined, limit: 2, withRates: false },
      );
    },
  );

  it('makes no file of a report without entries, and reads nothing', async () => {
    expect(await csvOf(UserRole.Member, 0)).toEqual({ status: 'empty' });
    expect(timeEntriesService.findReportCsvPage).not.toHaveBeenCalled();
  });

  it('makes no file of more entries than it may hold, and reads nothing', async () => {
    expect(await csvOf(UserRole.Admin, 6)).toEqual({
      status: 'too_many',
      maxEntries: 5,
    });
    expect(timeEntriesService.findReportCsvPage).not.toHaveBeenCalled();
  });

  it('stops reading once the entries logged since the report go over the limit', async () => {
    pages.push(
      [line({ id: 'a' }), line({ id: 'b' })],
      [line({ id: 'c' }), line({ id: 'd' })],
      [line({ id: 'e' }), line({ id: 'f' })],
      [line({ id: 'g' })],
    );

    expect(await csvOf(UserRole.Admin, 5)).toEqual({
      status: 'too_many',
      maxEntries: 5,
    });
    expect(timeEntriesService.findReportCsvPage).toHaveBeenCalledTimes(3);
  });

  it('writes a file of exactly the most entries it may hold', async () => {
    service = build({ pageSize: 5, maxEntries: 5 });
    pages.push(
      ['a', 'b', 'c', 'd', 'e'].map((id) => line({ id })),
      [],
    );

    const csv = await csvOf(UserRole.Admin, 5);

    expect(csv).toMatchObject({ status: 'ready', entryCount: 5 });
    expect(rowsOf((csv as { content: string }).content)).toHaveLength(6);
  });

  it('refuses a period longer than a year', async () => {
    await expect(
      service.getCsv({
        user: userWith(UserRole.Admin),
        report: reportOf(1, { fromDate: '2025-01-01' }),
        filters: {},
      }),
    ).rejects.toThrow(ValidationError);
  });
});
