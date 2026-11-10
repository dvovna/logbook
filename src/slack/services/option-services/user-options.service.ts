import { Injectable } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import TeamsService from '@modules/teams/services/teams.service';

import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';
interface ISearchUsersParams {
  query: string;
  user: IUserViewModel;
  includeInactive?: boolean;
  // Everyone in the workspace rather than the people `user` manages: a
  // project's assignments, as projects are the workspace's. The caller checks
  // the role.
  wholeWorkspace?: boolean;
}

interface ISearchUsersOptions {
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;

@Injectable()
export class UserOptionsService {
  public constructor(
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly timeEntriesScopeService: TimeEntriesScopeService,
  ) {}

  // The people whose time `user` sees (TimeEntriesScopeService), whose name
  // contains `query`: the time report's person filter.
  public async searchPeopleInScope(
    { query, user }: Pick<ISearchUsersParams, 'query' | 'user'>,
    { pageSize = DEFAULT_PAGE_SIZE }: ISearchUsersOptions = {},
  ) {
    const { people } = await this.timeEntriesScopeService.findPeople(user);
    const search = (query ?? '').toLowerCase();

    return {
      options: people
        .filter(({ name }) => name.toLowerCase().includes(search))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, pageSize)
        .map((person) => ({
          text: { type: 'plain_text', text: person.name },
          value: person.id,
        })),
    };
  }

  // The people `user` manages whose name or email contains `query`
  // (TeamsService.findManagedTeamIds): everyone for Admin and HR, the people
  // of their teams for a manager, nobody for anyone else. The scope comes
  // from the viewer, not from the select Slack names, which the client sends.
  public async searchUsers(
    {
      query,
      user,
      includeInactive = false,
      wholeWorkspace,
    }: ISearchUsersParams,
    { pageSize = DEFAULT_PAGE_SIZE }: ISearchUsersOptions = {},
  ) {
    const teamIds = wholeWorkspace
      ? null
      : await this.teamsService.findManagedTeamIds(user);

    if (teamIds?.length === 0) {
      return { options: [] };
    }

    const result = await this.usersService.search({
      searchTerm: query,
      pageSize,
      filters: {
        slackTeamId: user.slack_team_id,
        ...(teamIds ? { teamIds } : {}),
        includeInactive,
      },
    });

    return {
      options: result.items.map((user) => ({
        text: { type: 'plain_text', text: user.name },
        value: user.id,
      })),
    };
  }
}
