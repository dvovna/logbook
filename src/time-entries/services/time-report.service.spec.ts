import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import ClientsService from 'src/clients/services/clients.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import TeamsService from 'src/teams/services/teams.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import {
  TimeEntriesScopeService,
  TimeScope,
} from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import {
  TimeReportGrouping,
  TimeReportService,
} from 'src/time-entries/services/time-report.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';
const PERIOD = { fromDate: '2026-11-01', toDate: '2026-11-30' };

const userWith = (role: UserRole) =>
  ({ id: 'viewer', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const PEOPLE = { ann: 'Ann Admin', mia: 'Mia Member' } as const;
const PROJECTS = { web: 'Website', app: 'App', int: 'Internal' } as const;
const TEAMS = { backend: 'Backend' } as const;
const PROJECT_ROWS = [
  { id: 'web', name: PROJECTS.web, client_id: 'acme' },
  { id: 'app', name: PROJECTS.app, client_id: 'acme' },
  { id: 'int', name: PROJECTS.int, client_id: null },
];

const entry = (
  projectId: keyof typeof PROJECTS,
  person: keyof typeof PEOPLE,
  minutes: number,
  fields: Partial<ITimeEntryViewModel> = {},
) =>
  ({
    id: `${projectId}-${person}-${minutes}`,
    project_id: projectId,
    project: { id: projectId, name: PROJECTS[projectId] },
    user_id: person,
    user: { id: person, name: PEOPLE[person] },
    team_id: 'backend',
    team: { id: 'backend', name: TEAMS.backend },
    client_id: null,
    client: null,
    minutes,
    billable: projectId !== 'int',
    status: TimeEntryStatus.Approved,
    ...fields,
  }) as ITimeEntryViewModel;

describe('TimeReportService', () => {
  let entries: ITimeEntryViewModel[];
  let scope: TimeScope;
  let rates: Map<string, IProjectRates>;
  let projectRatesService: { findRates: jest.Mock };
  let slackTeamsService: { getCurrency: jest.Mock };
  let scopeService: { findEntries: jest.Mock; findPeople: jest.Mock };
  let timeEntriesService: { findMany: jest.Mock };
  let service: TimeReportService;

  beforeEach(() => {
    entries = [];
    scope = { kind: 'workspace' };
    rates = new Map();
    projectRatesService = { findRates: jest.fn(async () => rates) };
    slackTeamsService = { getCurrency: jest.fn().mockResolvedValue('EUR') };
    scopeService = {
      findEntries: jest.fn(async () => ({ scope, entries })),
      findPeople: jest.fn(),
    };
    timeEntriesService = { findMany: jest.fn(async () => entries) };

    service = new TimeReportService(
      scopeService as unknown as TimeEntriesScopeService,
      timeEntriesService as unknown as TimeEntriesService,
      {
        findMany: jest.fn(async ({ clientId }: { clientId?: string }) =>
          PROJECT_ROWS.filter(
            (project) => !clientId || project.client_id === clientId,
          ),
        ),
        findOne: jest.fn(
          async ({ id }: { id: string }) =>
            PROJECT_ROWS.find((project) => project.id === id) ?? null,
        ),
      } as unknown as ProjectsService,
      projectRatesService as unknown as ProjectRatesService,
      {
        findMany: jest.fn().mockResolvedValue([{ id: 'acme', name: 'Acme' }]),
        findOne: jest.fn(async ({ id }: { id: string }) =>
          id === 'acme' ? { id, name: 'Acme' } : null,
        ),
      } as unknown as ClientsService,
      {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'backend', name: TEAMS.backend }]),
      } as unknown as TeamsService,
      slackTeamsService as unknown as SlackTeamsService,
    );
  });

  const report = (groupBy: TimeReportGrouping, role = UserRole.Admin) =>
    service.getReport({ user: userWith(role), groupBy, ...PERIOD });

  it('adds up time by project, with amounts at the person or project rate', async () => {
    rates.set('web', {
      hourlyRate: 100,
      personRates: [{ userId: 'ann', name: PEOPLE.ann, hourlyRate: 150 }],
    });
    rates.set('app', { hourlyRate: null, personRates: [] });
    rates.set('int', { hourlyRate: 80, personRates: [] });
    entries.push(
      entry('web', 'mia', 90),
      entry('web', 'ann', 30, { status: TimeEntryStatus.Draft }),
      entry('web', 'ann', 30),
      entry('app', 'mia', 45, { status: TimeEntryStatus.Submitted }),
      entry('int', 'mia', 60),
    );

    expect(await report(TimeReportGrouping.Project)).toEqual({
      groupBy: TimeReportGrouping.Project,
      ...PERIOD,
      scope: 'workspace',
      filters: {},
      currency: 'EUR',
      rows: [
        {
          name: 'Website',
          minutes: 150,
          billableMinutes: 150,
          approvedMinutes: 120,
          // 1h 30m at 100 and 1h at Ann's own 150.
          amount: 30000,
        },
        // Not billable: a rate, but nothing to bill.
        {
          name: 'Internal',
          minutes: 60,
          billableMinutes: 0,
          approvedMinutes: 60,
          amount: 0,
        },
        {
          name: 'App',
          minutes: 45,
          billableMinutes: 45,
          approvedMinutes: 0,
          amount: 0,
        },
      ],
      total: {
        name: 'Total',
        minutes: 255,
        billableMinutes: 195,
        approvedMinutes: 180,
        amount: 30000,
      },
      unratedMinutes: 45,
    });
    expect(projectRatesService.findRates).toHaveBeenCalledWith(
      ['web', 'app', 'int'],
      userWith(UserRole.Admin),
    );
  });

  it("groups by the project's client, and by person and team", async () => {
    entries.push(
      entry('web', 'mia', 60),
      // Logged before the project had its client.
      entry('app', 'ann', 30, { team_id: null, team: null }),
      entry('int', 'mia', 15, {
        client_id: 'old',
        client: { id: 'old', name: 'Old client' },
      }),
    );

    const names = async (groupBy: TimeReportGrouping) =>
      (await report(groupBy)).rows.map(({ name, minutes }) => [name, minutes]);

    expect(await names(TimeReportGrouping.Client)).toEqual([
      ['Acme', 90],
      ['No client', 15],
    ]);
    expect(await names(TimeReportGrouping.Person)).toEqual([
      ['Mia Member', 75],
      ['Ann Admin', 30],
    ]);
    expect(await names(TimeReportGrouping.Team)).toEqual([
      ['Backend', 75],
      ['No team', 30],
    ]);
  });

  it('shows no amounts to a manager and reads no rates for them', async () => {
    scope = { kind: 'teams', teamIds: ['backend'] };
    entries.push(entry('web', 'mia', 60));

    const result = await report(TimeReportGrouping.Person, UserRole.Manager);

    expect(result).toMatchObject({
      scope: 'teams',
      currency: null,
      unratedMinutes: null,
      rows: [{ name: 'Mia Member', minutes: 60, amount: null }],
      total: { minutes: 60, amount: null },
    });
    expect(projectRatesService.findRates).not.toHaveBeenCalled();
    expect(slackTeamsService.getCurrency).not.toHaveBeenCalled();
  });

  it.each([
    ['2026-11-30', '2026-11-01'],
    ['2026-02-30', '2026-03-01'],
    ['2025-01-01', '2026-01-02'],
    ['', '2026-11-01'],
  ])(
    'refuses the period %s to %s before reading anything',
    async (fromDate, toDate) => {
      await expect(
        service.getReport({
          user: userWith(UserRole.Admin),
          groupBy: TimeReportGrouping.Project,
          fromDate,
          toDate,
        }),
      ).rejects.toThrow(ValidationError);
      expect(scopeService.findEntries).not.toHaveBeenCalled();
    },
  );

  describe('filters', () => {
    beforeEach(() => {
      entries.push(
        entry('web', 'mia', 90),
        entry('app', 'ann', 30),
        entry('int', 'mia', 60),
      );
    });

    const filtered = (filters: Record<string, string>) =>
      service.getReport({
        user: userWith(UserRole.Admin),
        groupBy: TimeReportGrouping.Project,
        ...PERIOD,
        filters,
      });

    it("narrow the report to a client's projects, a project or a person", async () => {
      const byClient = await filtered({ clientId: 'acme' });

      expect(byClient.rows.map(({ name }) => name)).toEqual([
        PROJECTS.web,
        PROJECTS.app,
      ]);
      expect(byClient.filters).toEqual({ client: 'Acme' });

      const byBoth = await filtered({ clientId: 'acme', userId: 'mia' });

      expect(byBoth.total.minutes).toBe(90);
      expect(byBoth.filters).toEqual({ client: 'Acme', person: PEOPLE.mia });

      const byProject = await filtered({ projectId: 'int' });

      expect(byProject.total.minutes).toBe(60);
      expect(byProject.filters).toEqual({ project: PROJECTS.int });
    });

    it('come after the scope, so they never widen it', async () => {
      await filtered({ userId: 'ann' });

      expect(scopeService.findEntries).toHaveBeenCalledWith(
        userWith(UserRole.Admin),
        { dateFrom: PERIOD.fromDate, dateTo: PERIOD.toDate },
      );
    });

    it("match nothing for a client or a project that isn't the workspace's", async () => {
      const otherClient = await filtered({ clientId: 'elsewhere' });
      const otherProject = await filtered({ projectId: 'elsewhere' });

      expect(otherClient.total.minutes).toBe(0);
      expect(otherClient.filters).toEqual({ client: 'Unknown client' });
      expect(otherProject.total.minutes).toBe(0);
      expect(otherProject.filters).toEqual({ project: 'Unknown project' });
    });
  });

  it('accepts a whole leap year', async () => {
    await expect(
      service.getReport({
        user: userWith(UserRole.Admin),
        groupBy: TimeReportGrouping.Project,
        fromDate: '2028-01-01',
        toDate: '2028-12-31',
      }),
    ).resolves.toMatchObject({ rows: [] });
  });

  describe('who has not submitted', () => {
    const person = (id: string, name: string, teamId: string | null) =>
      ({ id, name, team_id: teamId }) as IUserViewModel;

    it('lists who logged nothing, then who has drafts or rejected time', async () => {
      scope = { kind: 'teams', teamIds: ['backend'] };
      scopeService.findPeople.mockResolvedValue({
        scope,
        people: [
          person('ann', 'Ann', 'backend'),
          person('bob', 'Bob', null),
          person('cat', 'Cat', 'backend'),
          person('dan', 'Dan', 'backend'),
        ],
      });
      entries.push(
        entry('web', 'ann' as never, 60, {
          user_id: 'ann',
          status: TimeEntryStatus.Draft,
        }),
        entry('web', 'ann' as never, 30, {
          user_id: 'ann',
          status: TimeEntryStatus.Submitted,
        }),
        entry('web', 'cat' as never, 15, {
          user_id: 'cat',
          status: TimeEntryStatus.Rejected,
        }),
        entry('web', 'cat' as never, 30, {
          user_id: 'cat',
          status: TimeEntryStatus.Draft,
        }),
        entry('web', 'dan' as never, 60, {
          user_id: 'dan',
          status: TimeEntryStatus.Approved,
        }),
      );

      expect(
        await service.getMissingTime({
          user: userWith(UserRole.Manager),
          ...PERIOD,
        }),
      ).toEqual({
        ...PERIOD,
        scope: 'teams',
        peopleCount: 4,
        lines: [
          {
            name: 'Bob',
            teamName: null,
            loggedMinutes: 0,
            unsubmittedMinutes: 0,
            unsubmittedCount: 0,
          },
          {
            name: 'Ann',
            teamName: 'Backend',
            loggedMinutes: 90,
            unsubmittedMinutes: 60,
            unsubmittedCount: 1,
          },
          {
            name: 'Cat',
            teamName: 'Backend',
            loggedMinutes: 45,
            unsubmittedMinutes: 45,
            unsubmittedCount: 2,
          },
        ],
      });
      expect(timeEntriesService.findMany).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        userIds: ['ann', 'bob', 'cat', 'dan'],
        dateFrom: PERIOD.fromDate,
        dateTo: PERIOD.toDate,
      });
    });
  });
});
