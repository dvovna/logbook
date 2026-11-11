import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import ClientsService from 'src/clients/services/clients.service';
import ProjectsService from 'src/projects/services/projects.service';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import TeamsService from 'src/teams/services/teams.service';
import { TimeReportGrouping } from 'src/time-entries/enums/time-report-grouping.enum';
import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeReportService } from 'src/time-entries/services/time-report.service';
import {
  ITimeReportGroupSum,
  IUserTimeSum,
} from 'src/time-entries/types/time-report.types';
import { TimeScope } from 'src/time-entries/types/time-scope.types';
import { UsersService } from 'src/users/services/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';
const PERIOD = { fromDate: '2026-11-01', toDate: '2026-11-30' };

const userWith = (role: UserRole) =>
  ({ id: 'viewer', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const group = (
  name: string | null,
  minutes: number,
  fields: Partial<ITimeReportGroupSum> = {},
): ITimeReportGroupSum => ({
  key: name && name.toLowerCase(),
  name,
  entries: 1,
  minutes,
  billableMinutes: minutes,
  approvedMinutes: minutes,
  amount: 0,
  unratedMinutes: 0,
  ...fields,
});

describe('TimeReportService', () => {
  let groups: ITimeReportGroupSum[];
  let sums: IUserTimeSum[];
  let scope: TimeScope;
  let slackTeamsService: { getCurrency: jest.Mock };
  let scopeService: { scopeOf: jest.Mock; findPeople: jest.Mock };
  let timeEntriesService: { sumReportGroups: jest.Mock; sumOfUsers: jest.Mock };
  let service: TimeReportService;

  beforeEach(() => {
    groups = [];
    sums = [];
    scope = { kind: 'workspace' };
    slackTeamsService = { getCurrency: jest.fn().mockResolvedValue('EUR') };
    scopeService = {
      scopeOf: jest.fn(async () => scope),
      findPeople: jest.fn(),
    };
    timeEntriesService = {
      sumReportGroups: jest.fn(async () => groups),
      sumOfUsers: jest.fn(async () => sums),
    };

    service = new TimeReportService(
      scopeService as unknown as TimeEntriesScopeService,
      timeEntriesService as unknown as TimeEntriesService,
      {
        findOne: jest.fn(async ({ id }: { id: string }) =>
          id === 'int' ? { id, name: 'Internal' } : null,
        ),
      } as unknown as ProjectsService,
      {
        findOne: jest.fn(async ({ id }: { id: string }) =>
          id === 'acme' ? { id, name: 'Acme' } : null,
        ),
      } as unknown as ClientsService,
      {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'backend', name: 'Backend' }]),
      } as unknown as TeamsService,
      {
        findOne: jest.fn(async ({ id }: { id: string }) =>
          id === 'mia' ? { id, name: 'Mia Member' } : null,
        ),
      } as unknown as UsersService,
      slackTeamsService as unknown as SlackTeamsService,
    );
  });

  const report = (
    groupBy: TimeReportGrouping,
    role = UserRole.Admin,
    filters = {},
  ) => service.getReport({ user: userWith(role), groupBy, ...PERIOD, filters });

  it('shows the groups the database added up, most time first, with their total', async () => {
    groups.push(
      group('App', 45, {
        entries: 2,
        approvedMinutes: 0,
        unratedMinutes: 45,
      }),
      group('Website', 150, {
        entries: 3,
        approvedMinutes: 120,
        amount: 30000,
      }),
      group('Internal', 60, { billableMinutes: 0 }),
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
          amount: 30000,
        },
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
      entryCount: 6,
    });
    expect(timeEntriesService.sumReportGroups).toHaveBeenCalledWith(
      SLACK_TEAM_ID,
      {
        dateFrom: PERIOD.fromDate,
        dateTo: PERIOD.toDate,
        scope: {},
        filters: {},
      },
      TimeReportGrouping.Project,
    );
  });

  it.each([
    [TimeReportGrouping.Client, 'No client'],
    [TimeReportGrouping.Project, 'Unknown project'],
    [TimeReportGrouping.Person, 'Unknown user'],
    [TimeReportGrouping.Team, 'No team'],
  ])('names a %s group without a name %j', async (groupBy, name) => {
    groups.push(group('Zed', 15), group(null, 15));

    expect((await report(groupBy)).rows.map((row) => row.name)).toEqual(
      [name, 'Zed'].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("reads a manager's teams' time and their own, without amounts", async () => {
    scope = { kind: 'teams', teamIds: ['backend'] };
    groups.push(group('Mia Member', 60, { amount: 12000, unratedMinutes: 15 }));

    const result = await report(TimeReportGrouping.Person, UserRole.Manager);

    expect(result).toMatchObject({
      scope: 'teams',
      currency: null,
      unratedMinutes: null,
      rows: [{ name: 'Mia Member', minutes: 60, amount: null }],
      total: { minutes: 60, amount: null },
    });
    expect(timeEntriesService.sumReportGroups).toHaveBeenCalledWith(
      SLACK_TEAM_ID,
      expect.objectContaining({
        scope: { userId: 'viewer', teamIds: ['backend'] },
      }),
      TimeReportGrouping.Person,
    );
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
      expect(scopeService.scopeOf).not.toHaveBeenCalled();
      expect(timeEntriesService.sumReportGroups).not.toHaveBeenCalled();
    },
  );

  describe('filters', () => {
    it('go to the database after the scope, and name what they chose', async () => {
      scope = { kind: 'own' };
      groups.push(group('Website', 90));

      const filters = { clientId: 'acme', projectId: 'int', userId: 'mia' };
      const result = await report(
        TimeReportGrouping.Project,
        UserRole.Member,
        filters,
      );

      expect(result.filters).toEqual({
        client: 'Acme',
        project: 'Internal',
        person: 'Mia Member',
      });
      expect(timeEntriesService.sumReportGroups).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        {
          dateFrom: PERIOD.fromDate,
          dateTo: PERIOD.toDate,
          scope: { userId: 'viewer', teamIds: [] },
          filters,
        },
        TimeReportGrouping.Project,
      );
    });

    it("name what isn't the workspace's, and a person without time in the report, as unknown", async () => {
      const result = await report(TimeReportGrouping.Project, UserRole.Admin, {
        clientId: 'elsewhere',
        projectId: 'elsewhere',
        userId: 'mia',
      });

      expect(result.total.minutes).toBe(0);
      expect(result.filters).toEqual({
        client: 'Unknown client',
        project: 'Unknown project',
        person: 'Unknown person',
      });
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
    ).resolves.toMatchObject({ rows: [], entryCount: 0 });
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
      sums.push(
        { userId: 'ann', minutes: 90, openMinutes: 60, openCount: 1 },
        { userId: 'cat', minutes: 45, openMinutes: 45, openCount: 2 },
        { userId: 'dan', minutes: 60, openMinutes: 0, openCount: 0 },
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
      expect(timeEntriesService.sumOfUsers).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        userIds: ['ann', 'bob', 'cat', 'dan'],
        dateFrom: PERIOD.fromDate,
        dateTo: PERIOD.toDate,
      });
    });
  });
});
