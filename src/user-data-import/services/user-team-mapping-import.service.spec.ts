import { ForbiddenException, Logger } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import UserTeamMappingCsvParser from '@modules/user-data-import/parsers/user-team-mapping-csv.parser';
import { UserTeamMappingImportService } from '@modules/user-data-import/services/user-team-mapping-import.service';

const SLACK_TEAM_ID = 'slack-team-1';

const importer = {
  id: 'admin-1',
  role: UserRole.Admin,
  slack_team_id: SLACK_TEAM_ID,
} as IUserViewModel;

const csv = (...rows: string[]) => ['email;team_name', ...rows].join('\n');

describe('UserTeamMappingImportService', () => {
  let usersService: { findOne: jest.Mock; update: jest.Mock };
  let teamsService: { findOne: jest.Mock };
  let service: UserTeamMappingImportService;

  const people: Record<string, { team_id: string | null }> = {
    'ann@acme.test': { team_id: null },
    'bob@acme.test': { team_id: 'team-design' },
    'cid@acme.test': { team_id: 'team-dev' },
  };
  const teams: Record<string, string> = {
    Dev: 'team-dev',
    Design: 'team-design',
  };

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();

    usersService = {
      findOne: jest.fn(async ({ email }) =>
        people[email]
          ? {
              id: `id-${email}`,
              email,
              slack_team_id: SLACK_TEAM_ID,
              ...people[email],
            }
          : null,
      ),
      update: jest.fn().mockResolvedValue({}),
    };
    teamsService = {
      findOne: jest.fn(async ({ name }) =>
        teams[name] ? { id: teams[name], name } : null,
      ),
    };

    service = new UserTeamMappingImportService(
      usersService as unknown as UsersService,
      teamsService as unknown as TeamsService,
      new UserTeamMappingCsvParser(),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('moves people to the team with that exact name and counts what it did', async () => {
    const result = await service.handle(
      csv(
        'ann@acme.test;Dev', // no team yet
        'bob@acme.test;Dev', // from Design
        'cid@acme.test;Dev', // already there
      ),
      importer,
    );

    expect(result).toEqual({
      created: 1,
      updated: 1,
      skipped: 1,
      errors: [],
    });
    expect(usersService.update).toHaveBeenCalledTimes(2);
    expect(usersService.update).toHaveBeenCalledWith(
      { id: 'id-ann@acme.test', slackTeamId: SLACK_TEAM_ID },
      { teamId: 'team-dev' },
      importer,
    );
  });

  it('looks people and teams up only in the importer’s workspace', async () => {
    await service.handle(csv('ann@acme.test;Dev'), importer);

    expect(usersService.findOne).toHaveBeenCalledWith({
      email: 'ann@acme.test',
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(teamsService.findOne).toHaveBeenCalledWith({
      name: 'Dev',
      slackTeamId: SLACK_TEAM_ID,
    });
  });

  it('skips unknown people and teams and says which', async () => {
    const result = await service.handle(
      csv('nobody@acme.test;Dev', 'ann@acme.test;Marketing'),
      importer,
    );

    expect(result).toEqual({
      created: 0,
      updated: 0,
      skipped: 2,
      errors: ['User not found: nobody@acme.test', 'Team not found: Marketing'],
    });
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('goes on after a row the users service refuses', async () => {
    usersService.update.mockRejectedValueOnce(
      new ForbiddenException('Only an admin can change an admin'),
    );

    const result = await service.handle(
      csv('ann@acme.test;Dev', 'bob@acme.test;Dev'),
      importer,
    );

    expect(result).toEqual({
      created: 0,
      updated: 1,
      skipped: 1,
      errors: [
        'Failed to import ann@acme.test: Only an admin can change an admin',
      ],
    });
  });

  it('imports nothing from a file with an invalid row', async () => {
    const result = await service.handle(
      csv('ann@acme.test;Dev', 'not-an-email;Dev'),
      importer,
    );

    expect(result.errors).toEqual([
      expect.stringContaining('Invalid or missing email: not-an-email'),
    ]);
    expect(usersService.findOne).not.toHaveBeenCalled();
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('refuses a file of more than 1000 rows', async () => {
    const rows = Array.from(
      { length: 1001 },
      (_, index) => `user${index}@acme.test;Dev`,
    );

    const result = await service.handle(csv(...rows), importer);

    expect(result.errors).toEqual([
      'Too many records to process. Limit is 1000',
    ]);
    expect(usersService.findOne).not.toHaveBeenCalled();
  });
});
