import { Injectable } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import UserRole from '@common/enums/user-role.enum';

import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';
interface ISearchUsersParams {
  query: string;
  user: IUserViewModel;
  includeInactive?: boolean;
}

interface ISearchUsersOptions {
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 30;

@Injectable()
export class UserOptionsService {
  public constructor(
    private readonly usersService: UsersService,
    private readonly timeEntriesScopeService: TimeEntriesScopeService,
  ) {}

  // The people whose time `user` sees (TimeEntriesScopeService), whose name
  // contains `query`: the time report's person filter.
  public async searchPeopleInScope(
    { query, user }: Omit<ISearchUsersParams, 'includeInactive'>,
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

  public async searchUsers(
    { query, user, includeInactive = false }: ISearchUsersParams,
    { pageSize = DEFAULT_PAGE_SIZE }: ISearchUsersOptions = {},
  ) {
    const result = await this.usersService.search({
      searchTerm: query,
      pageSize,
      filters: {
        slackTeamId: user.slack_team_id,
        ...(user.role === UserRole.Manager
          ? { managerApprovers: [user.slack_id] }
          : {}),
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
