import { ForbiddenException } from '@nestjs/common';
import { ValidationError } from 'src/common/errors/validation.error';
import UserRole from 'src/common/enums/user-role.enum';
import ClientsService from 'src/clients/services/clients.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { IProjectRates } from 'src/projects/types/project-user-rate.types';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { BillingReportService } from 'src/time-entries/services/billing-report.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const PEOPLE = { ann: 'Ann Admin', mia: 'Mia Member' } as const;

const entry = (
  projectId: string,
  person: keyof typeof PEOPLE,
  minutes: number,
  fields: Partial<ITimeEntryViewModel> = {},
) =>
  ({
    project_id: projectId,
    user_id: person,
    user: { id: person, name: PEOPLE[person] },
    minutes,
    billable: true,
    status: TimeEntryStatus.Approved,
    ...fields,
  }) as ITimeEntryViewModel;

describe('BillingReportService', () => {
  let entries: ITimeEntryViewModel[];
  let billed: Set<string>;
  let rates: Map<string, IProjectRates>;
  let clientsService: { findOne: jest.Mock };
  let projectRatesService: { findRates: jest.Mock };
  let service: BillingReportService;

  beforeEach(() => {
    entries = [];
    billed = new Set();
    rates = new Map();
    clientsService = {
      findOne: jest.fn().mockResolvedValue({ id: 'acme', name: 'Acme' }),
    };
    projectRatesService = {
      findRates: jest.fn(async () => rates),
    };

    service = new BillingReportService(
      clientsService as unknown as ClientsService,
      {
        findMany: jest.fn().mockResolvedValue([
          { id: 'web', name: 'Website' },
          { id: 'app', name: 'App' },
        ]),
      } as unknown as ProjectsService,
      projectRatesService as unknown as ProjectRatesService,
      {
        findMany: jest.fn(async () => entries),
        findBilledIds: jest.fn(async () => billed),
      } as unknown as TimeEntriesService,
      {
        getCurrency: jest.fn().mockResolvedValue('USD'),
      } as unknown as SlackTeamsService,
    );
  });

  const report = (role = UserRole.Admin) =>
    service.getClientReport({
      user: userWith(role),
      clientId: 'acme',
      fromDate: '2026-10-01',
      toDate: '2026-10-31',
    });

  it("bills a person's own rate on a project, else the project's", async () => {
    rates.set('web', {
      hourlyRate: 100,
      personRates: [{ userId: 'ann', name: PEOPLE.ann, hourlyRate: 150 }],
    });
    rates.set('app', { hourlyRate: 80, personRates: [] });
    entries.push(
      entry('web', 'mia', 90),
      entry('web', 'ann', 30),
      entry('web', 'ann', 30),
      entry('app', 'ann', 45),
    );

    const result = await report();

    // Website first (more time), each project's people most time first.
    expect(result.lines).toEqual([
      {
        projectName: 'Website',
        personName: PEOPLE.mia,
        minutes: 90,
        billableMinutes: 90,
        hourlyRate: 100,
        amount: 15000,
      },
      {
        projectName: 'Website',
        personName: PEOPLE.ann,
        minutes: 60,
        billableMinutes: 60,
        hourlyRate: 150,
        amount: 15000,
      },
      {
        projectName: 'App',
        personName: PEOPLE.ann,
        minutes: 45,
        billableMinutes: 45,
        hourlyRate: 80,
        amount: 6000,
      },
    ]);
    expect(result).toMatchObject({
      currency: 'USD',
      approvedMinutes: 195,
      billableMinutes: 195,
      amount: 36000,
      unratedMinutes: 0,
    });
    expect(result.byPerson).toEqual([
      {
        name: PEOPLE.ann,
        minutes: 105,
        billableMinutes: 105,
        amount: 21000,
        unratedMinutes: 0,
      },
      {
        name: PEOPLE.mia,
        minutes: 90,
        billableMinutes: 90,
        amount: 15000,
        unratedMinutes: 0,
      },
    ]);
  });

  it('counts billable time without a rate apart, with no amount', async () => {
    rates.set('web', { hourlyRate: null, personRates: [] });
    rates.set('app', { hourlyRate: 60, personRates: [] });
    entries.push(
      entry('web', 'mia', 60),
      entry('app', 'mia', 30),
      entry('app', 'mia', 15, { billable: false }),
    );

    const result = await report();

    expect(result.lines).toEqual([
      expect.objectContaining({
        projectName: 'Website',
        hourlyRate: null,
        amount: null,
      }),
      expect.objectContaining({
        projectName: 'App',
        minutes: 45,
        billableMinutes: 30,
        hourlyRate: 60,
        amount: 3000,
      }),
    ]);
    expect(result).toMatchObject({
      approvedMinutes: 105,
      billableMinutes: 90,
      amount: 3000,
      unratedMinutes: 60,
    });
    expect(result.byProject).toEqual([
      {
        name: 'Website',
        minutes: 60,
        billableMinutes: 60,
        amount: 0,
        unratedMinutes: 60,
      },
      {
        name: 'App',
        minutes: 45,
        billableMinutes: 30,
        amount: 3000,
        unratedMinutes: 0,
      },
    ]);
  });

  it('gives no amount to time that is not billable', async () => {
    rates.set('web', { hourlyRate: 100, personRates: [] });
    entries.push(entry('web', 'mia', 60, { billable: false }));

    const result = await report();

    expect(result.lines).toEqual([
      expect.objectContaining({ hourlyRate: 100, amount: null }),
    ]);
    expect(result).toMatchObject({ amount: 0, unratedMinutes: 0 });
  });

  it('bills only approved time', async () => {
    rates.set('web', { hourlyRate: 100, personRates: [] });
    entries.push(
      entry('web', 'mia', 60),
      entry('web', 'mia', 30, { status: TimeEntryStatus.Submitted }),
      entry('web', 'mia', 15, { status: TimeEntryStatus.Rejected }),
    );

    const result = await report();

    expect(result).toMatchObject({
      approvedMinutes: 60,
      unapprovedMinutes: 45,
      amount: 10000,
    });
  });

  it('counts the approved time that billing snapshots hold already', async () => {
    entries.push(
      entry('web', 'mia', 60, { id: 'in-snapshot' }),
      entry('web', 'mia', 30, { id: 'not-yet' }),
      entry('web', 'ann', 15, {
        id: 'submitted',
        status: TimeEntryStatus.Submitted,
      }),
    );
    billed.add('in-snapshot');

    const result = await report();

    expect(result).toMatchObject({ approvedMinutes: 90, snapshotMinutes: 60 });
  });

  it.each([UserRole.Manager, UserRole.Member])(
    'is not made for a %s',
    async (role) => {
      await expect(report(role)).rejects.toThrow(ForbiddenException);
      expect(projectRatesService.findRates).not.toHaveBeenCalled();
    },
  );

  describe('assertCanReport', () => {
    it("checks that the client is the workspace's", async () => {
      await service.assertCanReport({
        user: userWith(UserRole.Finance),
        clientId: 'acme',
      });

      expect(clientsService.findOne).toHaveBeenCalledWith({
        id: 'acme',
        slackTeamId: SLACK_TEAM_ID,
        includeArchived: true,
      });

      clientsService.findOne.mockResolvedValue(null);

      await expect(
        service.assertCanReport({
          user: userWith(UserRole.Admin),
          clientId: 'elsewhere',
        }),
      ).rejects.toThrow(new ValidationError('Client not found.'));
    });

    it('refuses a manager without reading anything', async () => {
      await expect(
        service.assertCanReport({
          user: userWith(UserRole.Manager),
          clientId: 'acme',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(clientsService.findOne).not.toHaveBeenCalled();
    });
  });
});
