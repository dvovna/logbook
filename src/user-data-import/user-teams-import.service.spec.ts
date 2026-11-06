import { UserTeamsImportService } from 'src/user-data-import/user-teams-import.service';
import UserTeamsCsvParser from 'src/user-data-import/parsers/user-teams-csv.parser';
import { UsersService } from 'src/users/services/users.service';
import TeamsService from 'src/teams/services/teams.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';

const SLACK_TEAM_ID = 'slack-team-1';

const admin: IUserViewModel = {
  id: 'admin-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.Admin,
  is_active: true,
  team_id: null,
  slack_team_id: SLACK_TEAM_ID,
  slack_id: 'U_ADMIN',
  created_at: '2026-01-01T00:00:00Z',
};

const buildUser = (email: string, teamId: string | null = null) => ({
  ...admin,
  id: `id-${email}`,
  email,
  role: UserRole.Member,
  team_id: teamId,
});

describe('UserTeamsImportService', () => {
  let usersService: Record<'findOne' | 'update', jest.Mock>;
  let teamsService: { findMany: jest.Mock };
  let service: UserTeamsImportService;

  beforeEach(() => {
    usersService = { findOne: jest.fn(), update: jest.fn() };
    teamsService = {
      findMany: jest.fn().mockResolvedValue([
        { id: 'team-core', name: 'Core' },
        { id: 'team-design', name: 'Design ' },
      ]),
    };

    service = new UserTeamsImportService(
      usersService as unknown as UsersService,
      teamsService as unknown as TeamsService,
      new UserTeamsCsvParser(),
    );
  });

  it('moves users to the teams from the file, matching names case-insensitively', async () => {
    usersService.findOne.mockImplementation(({ email }) =>
      Promise.resolve(buildUser(email)),
    );

    const result = await service.handle(
      'email,team\nann@example.com,core\nbob@example.com,DESIGN\n',
      admin,
    );

    expect(teamsService.findMany).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(usersService.findOne).toHaveBeenCalledWith({
      email: 'ann@example.com',
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(usersService.update).toHaveBeenCalledWith(
      { id: 'id-ann@example.com', slackTeamId: SLACK_TEAM_ID },
      { teamId: 'team-core' },
      admin,
    );
    expect(usersService.update).toHaveBeenCalledWith(
      { id: 'id-bob@example.com', slackTeamId: SLACK_TEAM_ID },
      { teamId: 'team-design' },
      admin,
    );
    expect(result).toEqual({
      updated: 2,
      unchanged: 0,
      skipped: 0,
      errors: [],
    });
  });

  it('reports rows it could not apply and keeps going', async () => {
    usersService.findOne.mockImplementation(({ email }) =>
      Promise.resolve(
        email === 'ghost@example.com'
          ? null
          : buildUser(email, email === 'same@example.com' ? 'team-core' : null),
      ),
    );

    const result = await service.handle(
      [
        'email,team',
        'ghost@example.com,Core',
        'lost@example.com,Marketing',
        'same@example.com,Core',
        'ok@example.com,Core',
      ].join('\n'),
      admin,
    );

    expect(usersService.update).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      updated: 1,
      unchanged: 1,
      skipped: 2,
      errors: [
        'User not found: ghost@example.com',
        'Team not found for lost@example.com: Marketing',
      ],
    });
  });

  it('refuses a team name that matches more than one team', async () => {
    teamsService.findMany.mockResolvedValue([
      { id: 'team-1', name: 'Core' },
      { id: 'team-2', name: 'core' },
    ]);
    usersService.findOne.mockResolvedValue(buildUser('ann@example.com'));

    const result = await service.handle(
      'email,team\nann@example.com,Core\n',
      admin,
    );

    expect(usersService.update).not.toHaveBeenCalled();
    expect(result.errors).toEqual([
      'Team name is used by several teams, rename them first: Core',
    ]);
  });

  it('stops before changing anything when the file has invalid rows', async () => {
    const result = await service.handle(
      'email,team\nnot-an-email,Core\nann@example.com,\n',
      admin,
    );

    expect(usersService.findOne).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.errors[0]).toContain(
      'Invalid or missing email: not-an-email',
    );
    expect(result.errors[0]).toContain(
      'Missing team for user: ann@example.com',
    );
  });
});
