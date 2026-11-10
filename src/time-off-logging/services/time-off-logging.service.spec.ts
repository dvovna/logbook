import { ForbiddenException } from '@nestjs/common';
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

const SLACK_TEAM_ID = 'slack-team-1';

const user = {
  id: 'u1',
  team_id: 't1',
  slack_team_id: SLACK_TEAM_ID,
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
  let users: { findOneWithValidation: jest.Mock };
  let teams: { findOne: jest.Mock };
  let days: { workingDates: jest.Mock };
  let entries: { findMany: jest.Mock; createForVacation: jest.Mock };
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
    users = { findOneWithValidation: jest.fn().mockResolvedValue(user) };
    teams = {
      findOne: jest.fn().mockResolvedValue({ vacation_policy_id: 'v1' }),
    };
    days = {
      workingDates: jest.fn().mockResolvedValue(['2026-06-19', '2026-06-23']),
    };
    entries = {
      findMany: jest.fn().mockResolvedValue([]),
      createForVacation: jest.fn().mockResolvedValue(2),
    };
    lock = jest.fn();

    service = new TimeOffLoggingService(
      settings as unknown as TimeOffSettingsService,
      requests as unknown as VacationRequestsService,
      projects as unknown as ProjectsService,
      users as unknown as UsersService,
      teams as unknown as TeamsService,
      days as unknown as VacationDaysCalculationService,
      entries as unknown as TimeEntriesService,
      {
        transaction: (work: () => Promise<unknown>) => work(),
        lock,
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

  it('logs the days with no time yet, under a lock of the request', async () => {
    entries.findMany.mockResolvedValue([{ work_date: '2026-06-19T00:00:00Z' }]);

    const result = await service.log(user, 'r1');

    expect(lock).toHaveBeenCalledWith('time-off:r1');
    expect(entries.createForVacation).toHaveBeenCalledWith({
      userId: 'u1',
      teamId: 't1',
      projectId: 'p1',
      minutes: 480,
      dates: ['2026-06-23'],
      vacationRequestId: 'r1',
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(result).toMatchObject({
      logged: ['2026-06-23'],
      skipped: ['2026-06-19'],
    });
  });

  it('writes nothing when every day has time', async () => {
    entries.findMany.mockResolvedValue([
      { work_date: '2026-06-19' },
      { work_date: '2026-06-23' },
    ]);

    const result = await service.log(user, 'r1');

    expect(entries.createForVacation).not.toHaveBeenCalled();
    expect(result.logged).toEqual([]);
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
