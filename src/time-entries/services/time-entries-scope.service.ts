import { COMPANY_TIME_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import TeamsService from '@modules/teams/services/teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import {
  ITimeScopeFilter,
  TimeScope,
} from 'src/time-entries/types/time-scope.types';

// The entries `scope` lets `user` see, as conditions on entries: an entry
// counts for the team it was logged in (time_entries.team_id), as in
// Approvals.
export const scopeFilterOf = (
  scope: TimeScope,
  user: IUserViewModel,
): ITimeScopeFilter =>
  scope.kind === 'workspace'
    ? {}
    : {
        userId: user.id,
        teamIds: scope.kind === 'teams' ? scope.teamIds : [],
      };

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

  // The minutes of the period `user` sees, all and billable, deleted
  // entries left out, summed in the database.
  public async sumMinutes(
    user: IUserViewModel,
    period: IPeriod,
  ): Promise<{ minutes: number; billableMinutes: number }> {
    const scope = await this.scopeOf(user);

    return this.timeEntriesService.sumMinutes({
      slackTeamId: user.slack_team_id,
      ...period,
      ...scopeFilterOf(scope, user),
    });
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
