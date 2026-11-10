import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import UserRole from 'src/common/enums/user-role.enum';
import ClientsService from 'src/clients/services/clients.service';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectsRepository } from 'src/projects/repositories/projects.repository';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { IUserViewModel } from 'src/users/types/user.interface';

const SLACK_TEAM_ID = 'slack-team-1';

const userWith = (role: UserRole) =>
  ({ id: 'actor', role, slack_team_id: SLACK_TEAM_ID }) as IUserViewModel;

// A project's rate is Admin's and Finance's to set, whichever handler calls.
describe('ProjectsService rates', () => {
  let repository: Record<'count' | 'create' | 'update', jest.Mock>;
  let service: ProjectsService;

  beforeEach(() => {
    repository = {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn(async (row) => row),
      update: jest.fn(async (_filter, row) => row),
    };

    service = new ProjectsService(
      repository as unknown as ProjectsRepository,
      { getOrThrow: () => 10 } as unknown as ConfigService,
      {} as ClientsService,
    );
  });

  const create = (role: UserRole, hourlyRate?: number | null) =>
    service.create(
      {
        name: 'Website',
        billable: true,
        status: ProjectStatus.Active,
        slackTeamId: SLACK_TEAM_ID,
        hourlyRate,
      },
      userWith(role),
    );

  it('stores the rate Admin or Finance sets', async () => {
    await create(UserRole.Finance, 120.5);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ hourly_rate: 120.5 }),
    );
  });

  it('refuses a rate from a manager, also when changing a project', async () => {
    await expect(create(UserRole.Manager, 120)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.update(
        { id: 'project-1', slackTeamId: SLACK_TEAM_ID },
        { hourlyRate: null },
        userWith(UserRole.Manager),
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('lets a manager archive a project, which sets no rate', async () => {
    await service.update(
      { id: 'project-1', slackTeamId: SLACK_TEAM_ID },
      { archivedAt: '2026-06-17T00:00:00Z' },
      userWith(UserRole.Manager),
    );

    expect(repository.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ hourly_rate: expect.anything() }),
    );
  });

  it('refuses a rate with more than two decimals', async () => {
    await expect(create(UserRole.Admin, 9.999)).rejects.toMatchObject({
      field: 'hourlyRate',
    });
  });
});
