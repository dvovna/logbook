import UserRole from 'src/common/enums/user-role.enum';
import TeamsService from 'src/teams/services/teams.service';
import { UsersService } from 'src/users/services/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

const SLACK_TEAM_ID = 'slack-team-1';
const PERIOD = { dateFrom: '2026-11-01', dateTo: '2026-11-30' };

const userWith = (role: UserRole) =>
  ({
    id: 'viewer',
    name: 'Vic Viewer',
    role,
    slack_id: 'UVIEWER',
    slack_team_id: SLACK_TEAM_ID,
  }) as IUserViewModel;

const entry = (id: string) => ({ id }) as ITimeEntryViewModel;

describe('TimeEntriesScopeService', () => {
  let managedTeamIds: string[] | null;
  let timeEntriesService: { findMany: jest.Mock; sumMinutes: jest.Mock };
  let usersService: { findMany: jest.Mock };
  let service: TimeEntriesScopeService;

  beforeEach(() => {
    managedTeamIds = [];
    timeEntriesService = {
      findMany: jest.fn(async (params: { userId?: string }) =>
        params.userId ? [entry('own'), entry('shared')] : [entry('shared')],
      ),
      sumMinutes: jest.fn().mockResolvedValue({
        minutes: 90,
        billableMinutes: 60,
      }),
    };
    usersService = {
      findMany: jest.fn().mockResolvedValue([{ id: 'mia', name: 'Mia' }]),
    };
    service = new TimeEntriesScopeService(
      timeEntriesService as unknown as TimeEntriesService,
      {
        findManagedTeamIds: jest.fn(async () => managedTeamIds),
      } as unknown as TeamsService,
      usersService as unknown as UsersService,
    );
  });

  it.each([UserRole.Admin, UserRole.HR])(
    "gives %s everyone's time",
    async (role) => {
      managedTeamIds = null;

      const { scope, entries } = await service.findEntries(
        userWith(role),
        PERIOD,
      );

      expect(scope).toEqual({ kind: 'workspace' });
      expect(entries).toEqual([entry('shared')]);
      expect(timeEntriesService.findMany).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        ...PERIOD,
      });
    },
  );

  it("gives a manager their teams' time and their own, each entry once", async () => {
    managedTeamIds = ['backend', 'design'];

    const { scope, entries } = await service.findEntries(
      userWith(UserRole.Manager),
      PERIOD,
    );

    expect(scope).toEqual({ kind: 'teams', teamIds: ['backend', 'design'] });
    expect(entries).toEqual([entry('shared'), entry('own')]);
    expect(timeEntriesService.findMany).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      ...PERIOD,
      teamIds: ['backend', 'design'],
    });
    expect(timeEntriesService.findMany).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      ...PERIOD,
      userId: 'viewer',
    });
  });

  it.each([UserRole.Member, UserRole.Manager])(
    'gives a %s of no team only their own time',
    async (role) => {
      const { scope } = await service.findEntries(userWith(role), PERIOD);

      expect(scope).toEqual({ kind: 'own' });
      expect(timeEntriesService.findMany).toHaveBeenCalledTimes(1);
      expect(timeEntriesService.findMany).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        ...PERIOD,
        userId: 'viewer',
      });
    },
  );

  it.each([
    [UserRole.HR, null, {}],
    [UserRole.Manager, ['backend'], { userId: 'viewer', teamIds: ['backend'] }],
    [UserRole.Member, [], { userId: 'viewer', teamIds: [] }],
  ])(
    'sums the time a %s sees in the database',
    async (role, teamIds, narrowing) => {
      managedTeamIds = teamIds;

      await expect(service.sumMinutes(userWith(role), PERIOD)).resolves.toEqual(
        { minutes: 90, billableMinutes: 60 },
      );
      expect(timeEntriesService.sumMinutes).toHaveBeenCalledWith({
        slackTeamId: SLACK_TEAM_ID,
        ...PERIOD,
        ...narrowing,
      });
      expect(timeEntriesService.findMany).not.toHaveBeenCalled();
    },
  );

  it('counts a manager among the people of their teams', async () => {
    managedTeamIds = ['backend'];
    const manager = userWith(UserRole.Manager);

    const { people } = await service.findPeople(manager);

    expect(people).toEqual([{ id: 'mia', name: 'Mia' }, manager]);
    expect(usersService.findMany).toHaveBeenCalledWith({
      slackTeamId: SLACK_TEAM_ID,
      teamIds: ['backend'],
    });
  });

  it('gives a member only themselves', async () => {
    const member = userWith(UserRole.Member);

    expect(await service.findPeople(member)).toEqual({
      scope: { kind: 'own' },
      people: [member],
    });
    expect(usersService.findMany).not.toHaveBeenCalled();
  });
});
