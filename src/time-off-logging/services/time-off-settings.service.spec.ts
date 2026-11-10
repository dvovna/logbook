import { ForbiddenException } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import ProjectsService from 'src/projects/services/projects.service';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { TransactionService } from 'src/database/transaction.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { TimeOffProjectsRepository } from 'src/time-off-logging/repositories/time-off-projects.repository';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

describe('TimeOffSettingsService', () => {
  let slackTeams: Record<
    'getTimeOffMinutesPerDay' | 'setTimeOffMinutesPerDay',
    jest.Mock
  >;
  let projects: { findMany: jest.Mock };
  let repository: Record<'findMany' | 'deleteMany' | 'createMany', jest.Mock>;
  let transaction: jest.Mock;
  let service: TimeOffSettingsService;

  beforeEach(() => {
    slackTeams = {
      getTimeOffMinutesPerDay: jest.fn().mockResolvedValue(480),
      setTimeOffMinutesPerDay: jest.fn(),
    };
    projects = { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) };
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    };
    transaction = jest.fn((work: () => Promise<void>) => work());

    service = new TimeOffSettingsService(
      slackTeams as unknown as SlackTeamsService,
      projects as unknown as ProjectsService,
      repository as unknown as TimeOffProjectsRepository,
      { transaction } as unknown as TransactionService,
    );
  });

  it('reads the hours and the project of each type', async () => {
    slackTeams.getTimeOffMinutesPerDay.mockResolvedValue(450);
    repository.findMany.mockResolvedValue([
      { vacation_type: 'sick_leave', project_id: 'p1' },
    ]);

    await expect(service.get(SLACK_TEAM_ID)).resolves.toEqual({
      minutesPerDay: 450,
      projectIds: { sick_leave: 'p1' },
    });
    expect(repository.findMany).toHaveBeenCalledWith({
      slack_team_id: SLACK_TEAM_ID,
    });
  });

  it('replaces the hours and projects in one transaction', async () => {
    await service.set(userWith(UserRole.Admin), {
      minutesPerDay: 450,
      projectIds: { annual_leave: 'p1' },
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(slackTeams.setTimeOffMinutesPerDay).toHaveBeenCalledWith(
      SLACK_TEAM_ID,
      450,
    );
    expect(repository.deleteMany).toHaveBeenCalledWith({
      slack_team_id: SLACK_TEAM_ID,
    });
    expect(repository.createMany).toHaveBeenCalledWith([
      {
        slack_team_id: SLACK_TEAM_ID,
        vacation_type: 'annual_leave',
        project_id: 'p1',
      },
    ]);
  });

  it.each([UserRole.HR, UserRole.Manager, UserRole.Finance, UserRole.Member])(
    'refuses a %s',
    async (role) => {
      await expect(
        service.set(userWith(role), { minutesPerDay: 480, projectIds: {} }),
      ).rejects.toThrow(ForbiddenException);
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("names the leave type of a project that is not the workspace's", async () => {
    await expect(
      service.set(userWith(UserRole.Admin), {
        minutesPerDay: 480,
        projectIds: { annual_leave: 'p1', sick_leave: 'foreign' },
      }),
    ).rejects.toMatchObject({
      constructor: ValidationError,
      field: 'sick_leave',
    });
    expect(projects.findMany).toHaveBeenCalledWith({
      ids: ['p1', 'foreign'],
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('refuses "other" and a day that is not 15-minute steps', async () => {
    await expect(
      service.set(userWith(UserRole.Admin), {
        minutesPerDay: 480,
        projectIds: { other: 'p1' },
      }),
    ).rejects.toMatchObject({ field: 'other' });
    await expect(
      service.set(userWith(UserRole.Admin), {
        minutesPerDay: 470,
        projectIds: {},
      }),
    ).rejects.toMatchObject({ field: 'hours' });
  });
});
