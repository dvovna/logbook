import { ForbiddenException } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import { ValidationError } from 'src/common/errors/validation.error';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectRatesService } from 'src/projects/services/project-rates.service';
import { ProjectUserRatesRepository } from 'src/projects/repositories/project-user-rates.repository';
import { UsersService } from 'src/users/services/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

const PROJECT = { id: 'project-1', name: 'Website', hourly_rate: 100 };
const ADA = { id: 'ada', name: 'Ada Lovelace' };

describe('ProjectRatesService', () => {
  let repository: Record<'findMany' | 'deleteMany' | 'setRate', jest.Mock>;
  let projectsService: Record<'findOne' | 'findMany', jest.Mock>;
  let usersService: { findOne: jest.Mock };
  let service: ProjectRatesService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      setRate: jest.fn(),
    };
    projectsService = {
      findOne: jest.fn().mockResolvedValue(PROJECT),
      findMany: jest.fn().mockResolvedValue([PROJECT]),
    };
    usersService = { findOne: jest.fn().mockResolvedValue(ADA) };

    service = new ProjectRatesService(
      repository as unknown as ProjectUserRatesRepository,
      projectsService as unknown as ProjectsService,
      usersService as unknown as UsersService,
    );
  });

  describe('setPersonRate', () => {
    const setRate = (hourlyRate: number | null, role = UserRole.Finance) =>
      service.setPersonRate({
        projectId: PROJECT.id,
        userId: ADA.id,
        hourlyRate,
        user: userWith(role),
      });

    it("sets the person's rate, looking both up in the user's workspace", async () => {
      await expect(setRate(150)).resolves.toEqual({
        project: PROJECT,
        person: ADA,
        hourlyRate: 150,
      });

      expect(projectsService.findOne).toHaveBeenCalledWith({
        id: PROJECT.id,
        slackTeamId: SLACK_TEAM_ID,
        includeArchived: true,
      });
      expect(usersService.findOne).toHaveBeenCalledWith({
        id: ADA.id,
        slackTeamId: SLACK_TEAM_ID,
        includeInactive: true,
      });
      expect(repository.setRate).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        projectId: PROJECT.id,
        userId: ADA.id,
        hourlyRate: 150,
        updatedBy: 'actor',
      });
      expect(repository.deleteMany).not.toHaveBeenCalled();
    });

    it('removes it when there is no rate', async () => {
      await setRate(null);

      expect(repository.deleteMany).toHaveBeenCalledWith({
        slack_team_id: SLACK_TEAM_ID,
        project_id: PROJECT.id,
        user_id: ADA.id,
      });
      expect(repository.setRate).not.toHaveBeenCalled();
    });

    it.each([UserRole.HR, UserRole.Manager, UserRole.Member])(
      'refuses a %s',
      async (role) => {
        await expect(setRate(150, role)).rejects.toThrow(ForbiddenException);
        expect(repository.setRate).not.toHaveBeenCalled();
      },
    );

    it('refuses a person or a project of another workspace', async () => {
      usersService.findOne.mockResolvedValueOnce(null);
      await expect(setRate(150)).rejects.toThrow(
        new ValidationError('This person is not in this workspace.', 'person'),
      );

      projectsService.findOne.mockResolvedValueOnce(null);
      await expect(setRate(150)).rejects.toThrow(ValidationError);

      expect(repository.setRate).not.toHaveBeenCalled();
    });

    it.each([-1, 12.345, 2_000_000])('refuses a rate of %s', async (rate) => {
      await expect(setRate(rate)).rejects.toMatchObject({
        field: 'hourlyRate',
      });
      expect(repository.setRate).not.toHaveBeenCalled();
    });
  });

  describe('findRates', () => {
    it("gives each project's rate and its people's own rates by name", async () => {
      repository.findMany.mockResolvedValue([
        {
          project_id: PROJECT.id,
          user_id: 'zoe',
          hourly_rate: 90,
          user: { id: 'zoe', name: 'Zoe' },
        },
        {
          project_id: PROJECT.id,
          user_id: ADA.id,
          hourly_rate: 150,
          user: ADA,
        },
      ]);

      const rates = await service.findRates(
        [PROJECT.id],
        userWith(UserRole.Admin),
      );

      expect(rates.get(PROJECT.id)).toEqual({
        hourlyRate: 100,
        personRates: [
          { userId: ADA.id, name: 'Ada Lovelace', hourlyRate: 150 },
          { userId: 'zoe', name: 'Zoe', hourlyRate: 90 },
        ],
      });
      expect(repository.findMany).toHaveBeenCalledWith({
        slack_team_id: SLACK_TEAM_ID,
        project_id: { operator: 'in', value: [PROJECT.id] },
      });
    });

    it('refuses a manager', async () => {
      await expect(
        service.findRates([PROJECT.id], userWith(UserRole.Manager)),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.findPersonRates(PROJECT.id, userWith(UserRole.Manager)),
      ).rejects.toThrow(ForbiddenException);
      expect(repository.findMany).not.toHaveBeenCalled();
    });
  });
});
