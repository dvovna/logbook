import { ForbiddenException } from '@nestjs/common';
import {
  timesheetLock,
  vacationRequestLock,
} from 'src/database/advisory-locks';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import { TransactionService } from 'src/database/transaction.service';
import ProjectsService from 'src/projects/services/projects.service';
import TeamsService from 'src/teams/services/teams.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { UsersService } from 'src/users/services/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationDaysCalculationService } from 'src/vacation-requests/services/vacation-days-calculation.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';
import { VacationTimeService } from 'src/time-off-logging/services/vacation-time.service';

const SLACK_TEAM_ID = 'slack-team-1';

const user = {
  id: 'u1',
  team_id: 't1',
  slack_team_id: SLACK_TEAM_ID,
  is_active: true,
} as IUserViewModel;

const request = (
  fields: Partial<IVacationRequestViewModel> = {},
): IVacationRequestViewModel =>
  ({
    id: 'r1',
    user_id: 'u1',
    status: VacationRequestStatus.Approved,
    type: VacationType.AnnualLeave,
    start_date: '2026-06-19',
    end_date: '2026-06-23',
    slack_team_id: SLACK_TEAM_ID,
    ...fields,
  }) as IVacationRequestViewModel;

describe('TimeOffLoggingService', () => {
  let settings: { get: jest.Mock };
  let requests: { findOneWithValidation: jest.Mock };
  let projects: { findMany: jest.Mock };
  let users: { findOne: jest.Mock };
  let teams: { findOne: jest.Mock };
  let days: { workingDates: jest.Mock };
  let entries: { findMany: jest.Mock };
  let vacationTime: { log: jest.Mock };
  let lock: jest.Mock;
  let service: TimeOffLoggingService;

  beforeEach(() => {
    settings = {
      get: jest.fn().mockResolvedValue({
        minutesPerDay: 480,
        projectIds: { annual_leave: 'p1' },
      }),
    };
    requests = {
      findOneWithValidation: jest.fn().mockResolvedValue(request()),
    };
    projects = {
      findMany: jest.fn().mockResolvedValue([{ id: 'p1', name: 'Vacations' }]),
    };
    users = { findOne: jest.fn().mockResolvedValue(user) };
    teams = {
      findOne: jest.fn().mockResolvedValue({ vacation_policy_id: 'v1' }),
    };
    days = {
      workingDates: jest.fn().mockResolvedValue(['2026-06-19', '2026-06-23']),
    };
    entries = { findMany: jest.fn().mockResolvedValue([]) };
    vacationTime = { log: jest.fn().mockResolvedValue(2) };
    lock = jest.fn();

    service = new TimeOffLoggingService(
      settings as unknown as TimeOffSettingsService,
      requests as unknown as VacationRequestsService,
      projects as unknown as ProjectsService,
      users as unknown as UsersService,
      teams as unknown as TeamsService,
      days as unknown as VacationDaysCalculationService,
      entries as unknown as TimeEntriesService,
      vacationTime as unknown as VacationTimeService,
      {
        transaction: (work: () => Promise<unknown>) => work(),
        lockInOrder: lock,
      } as unknown as TransactionService,
    );
  });

  it('counts the days by the requester team policy', async () => {
    await service.offerFor(request());

    expect(days.workingDates).toHaveBeenCalledWith(
      new Date('2026-06-19'),
      new Date('2026-06-23'),
      'v1',
      SLACK_TEAM_ID,
    );
  });

  it('offers nothing for time off that is not approved', async () => {
    await expect(
      service.offerFor(request({ status: VacationRequestStatus.Pending })),
    ).resolves.toBeNull();
  });

  it('offers nothing when the type has no project or it is archived', async () => {
    await expect(
      service.offerFor(request({ type: VacationType.SickLeave })),
    ).resolves.toBeNull();

    projects.findMany.mockResolvedValue([]);

    await expect(service.offerFor(request())).resolves.toBeNull();
  });

  it('offers nothing to a requester who was deactivated', async () => {
    users.findOne.mockResolvedValue({ ...user, is_active: false });

    await expect(service.offerFor(request())).resolves.toBeNull();
    expect(users.findOne).toHaveBeenCalledWith({
      id: 'u1',
      slackTeamId: SLACK_TEAM_ID,
      includeInactive: true,
    });
  });

  it('offers nothing when no working days are left', async () => {
    days.workingDates.mockResolvedValue([]);

    await expect(service.offerFor(request())).resolves.toBeNull();
    await expect(service.log(user, 'r1')).rejects.toThrow(ValidationError);
    expect(entries.findMany).not.toHaveBeenCalled();
  });

  it("logs the days with no time yet, under the request's and the user's locks", async () => {
    entries.findMany.mockResolvedValue([
      { work_date: '2026-06-19T00:00:00Z', project_id: 'p1' },
    ]);

    const result = await service.log(user, 'r1');

    // The request's lock and the one a timesheet save of the user takes.
    expect(lock.mock.calls).toEqual([
      [vacationRequestLock('r1'), timesheetLock('u1')],
    ]);
    expect(entries.findMany).toHaveBeenCalledWith({
      userId: 'u1',
      dateFrom: '2026-06-19',
      dateTo: '2026-06-23',
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(vacationTime.log).toHaveBeenCalledWith({
      userId: 'u1',
      teamId: 't1',
      projectId: 'p1',
      minutes: 480,
      dates: ['2026-06-23'],
      vacationRequestId: 'r1',
      description: 'Annual leave',
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(result).toMatchObject({ logged: ['2026-06-23'] });
  });

  it('writes nothing when every day has time', async () => {
    entries.findMany.mockResolvedValue([
      { work_date: '2026-06-19', project_id: 'p1' },
      { work_date: '2026-06-23', project_id: 'p1' },
    ]);

    const result = await service.log(user, 'r1');

    expect(vacationTime.log).not.toHaveBeenCalled();
    expect(result.logged).toEqual([]);
  });

  // HR changed the type after a snapshot billed some of its days on the old
  // type's project: those days keep that time and get no second entry.
  it("skips a day with the request's time on another project", async () => {
    entries.findMany.mockResolvedValue([
      {
        work_date: '2026-06-19',
        project_id: 'p0',
        project: { id: 'p0', name: 'Old leave' },
        vacation_request_id: 'r1',
      },
      // Other work of theirs that day doesn't count.
      { work_date: '2026-06-23', project_id: 'p9', vacation_request_id: null },
    ]);

    const result = await service.log(user, 'r1');

    expect(result).toMatchObject({
      logged: ['2026-06-23'],
      linked: {
        dates: ['2026-06-23'],
        minutes: 480,
        otherProjects: [{ projectName: 'Old leave', dates: ['2026-06-19'] }],
      },
    });
  });

  it("refuses another person's time off", async () => {
    await expect(
      service.log({ ...user, id: 'u2' } as IUserViewModel, 'r1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses time off that is no longer approved', async () => {
    requests.findOneWithValidation.mockResolvedValue(
      request({ status: VacationRequestStatus.Canceled }),
    );

    await expect(service.log(user, 'r1')).rejects.toThrow(
      new ValidationError('This time off is no longer approved.'),
    );
  });
});
