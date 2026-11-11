import { COMPANY_TIME_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

// Whose time a person sees in reports and exports:
// - workspace: Admin, HR and Finance (COMPANY_TIME_ROLES), everyone's;
// - teams: a manager, the time logged in the teams that list them among
//   their manager approvers, and their own;
// - own: everyone else, and a manager of no team, only their own.
export type TimeScope =
  | { kind: 'workspace' }
  | { kind: 'teams'; teamIds: string[] }
  | { kind: 'own' };

export type TimeScopeKind = TimeScope['kind'];

interface IPeriod {
  dateFrom: string;
  dateTo: string;
}

// The scope comes from the viewer alone, never from what a form or a button
// sent, so no filter can widen it.
@Injectable()
export class TimeEntriesScopeService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
  ) {}

  public async scopeOf(user: IUserViewModel): Promise<TimeScope> {
    if (COMPANY_TIME_ROLES.includes(user.role)) {
      return { kind: 'workspace' };
    }

    const teamIds = await this.teamsService.findManagedTeamIds(user);

    return teamIds?.length ? { kind: 'teams', teamIds } : { kind: 'own' };
  }

  // The entries of the period `user` sees, deleted ones left out. An entry
  // counts for the team it was logged in (time_entries.team_id), as in
  // Approvals.
  public async findEntries(
    user: IUserViewModel,
    period: IPeriod,
  ): Promise<{ scope: TimeScope; entries: ITimeEntryViewModel[] }> {
    const scope = await this.scopeOf(user);
    const params = { slackTeamId: user.slack_team_id, ...period };

    if (scope.kind === 'workspace') {
      return { scope, entries: await this.timeEntriesService.findMany(params) };
    }

    const own = this.timeEntriesService.findMany({
      ...params,
      userId: user.id,
    });

    if (scope.kind === 'own') {
      return { scope, entries: await own };
    }

    const [teamEntries, ownEntries] = await Promise.all([
      this.timeEntriesService.findMany({ ...params, teamIds: scope.teamIds }),
      own,
    ]);
    const byId = new Map(
      [...teamEntries, ...ownEntries].map((entry) => [entry.id, entry]),
    );

    return { scope, entries: [...byId.values()] };
  }

  // The active people whose time `user` sees: everyone, the people of the
  // teams they manage and themselves, or only themselves.
  public async findPeople(
    user: IUserViewModel,
  ): Promise<{ scope: TimeScope; people: IUserViewModel[] }> {
    const scope = await this.scopeOf(user);
    const slackTeamId = user.slack_team_id;

    if (scope.kind === 'workspace') {
      return {
        scope,
        people: await this.usersService.findMany({ slackTeamId }),
      };
    }

    if (scope.kind === 'own') {
      return { scope, people: [user] };
    }

    const members = await this.usersService.findMany({
      slackTeamId,
      teamIds: scope.teamIds,
    });

    return {
      scope,
      people: members.some(({ id }) => id === user.id)
        ? members
        : [...members, user],
    };
  }
}
