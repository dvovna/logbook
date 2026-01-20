import { Injectable } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import UserRole from '@common/enums/user-role.enum';

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
export class SlackUserOptionsService {
  public constructor(private readonly usersService: UsersService) {}

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
