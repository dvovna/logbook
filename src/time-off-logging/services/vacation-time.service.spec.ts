import { ValidationError } from 'src/common/errors/validation.error';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';
import { VacationTimeService } from 'src/time-off-logging/services/vacation-time.service';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'team-1';

describe('VacationTimeService', () => {
  let repository: Record<'createMany' | 'deleteVacationTime', jest.Mock>;
  let projects: { findOne: jest.Mock };
  let service: VacationTimeService;

  beforeEach(() => {
    repository = {
      createMany: jest.fn(async (rows: unknown[]) => rows),
      deleteVacationTime: jest.fn(),
    };
    projects = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'web', client_id: 'acme', billable: false }),
    };
    service = new VacationTimeService(
      projects as unknown as ProjectsService,
      new TimeEntryWriter(repository as unknown as TimeEntriesRepository),
    );
  });

  const params = {
    userId: 'me',
    teamId: 't1',
    projectId: 'web',
    minutes: 480,
    dates: ['2026-06-19', '2026-06-22'],
    vacationRequestId: 'r1',
    description: 'Annual leave',
    slackTeamId: SLACK_TEAM_ID,
  };

  it("logs approved time on each day, linked to the request, as the requester's", async () => {
    await expect(service.log(params)).resolves.toBe(2);

    expect(repository.createMany).toHaveBeenCalledWith(
      ['2026-06-19', '2026-06-22'].map((date) =>
        expect.objectContaining({
          user_id: 'me',
          team_id: 't1',
          project_id: 'web',
          client_id: 'acme',
          billable: false,
          work_date: `${date}T00:00:00.000Z`,
          minutes: 480,
          description: 'Annual leave',
          status: TimeEntryStatus.Approved,
          vacation_request_id: 'r1',
          slack_team_id: SLACK_TEAM_ID,
          created_by: 'me',
        }),
      ),
    );
  });

  it('creates nothing for time off with no days', async () => {
    await expect(service.log({ ...params, dates: [] })).resolves.toBe(0);
    expect(repository.createMany).not.toHaveBeenCalled();
  });

  it("refuses a project that isn't the workspace's", async () => {
    projects.findOne.mockResolvedValue(null);

    await expect(service.log(params)).rejects.toThrow(
      new ValidationError('Project not found'),
    );
    expect(repository.createMany).not.toHaveBeenCalled();
  });

  it("tells whose time went and which billed days' time stays", async () => {
    repository.deleteVacationTime.mockResolvedValue({
      deleted: [
        { user_id: 'me', minutes: 480, project_id: 'web' },
        { user_id: 'me', minutes: 240, project_id: 'old' },
        { user_id: 'me', minutes: 480, project_id: 'web' },
        { user_id: 'other', minutes: 480, project_id: 'web' },
      ],
      billedDates: ['2026-06-23', '2026-06-19T00:00:00Z', '2026-06-19'],
    });

    const removed = await service.remove('r1', SLACK_TEAM_ID, {
      id: 'hr-1',
    } as IUserViewModel);

    expect(repository.deleteVacationTime).toHaveBeenCalledWith(
      SLACK_TEAM_ID,
      'r1',
      'hr-1',
    );
    expect(removed).toEqual({
      deleted: 4,
      owners: [
        { userId: 'me', minutes: 1200, projectIds: ['web', 'old'] },
        { userId: 'other', minutes: 480, projectIds: ['web'] },
      ],
      billedDates: ['2026-06-19', '2026-06-23'],
    });
  });
});
