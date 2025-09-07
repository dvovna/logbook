import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
export class SlackUserOptionsService {
  public constructor(private readonly usersService: UsersService) {}

  public async searchUsers(query: string, user: IUserViewModel) {
    const result = await this.usersService.search({
      searchTerm: query,
      pageSize: 30,
      filters: {
        slackTeamId: user.slack_team_id,
        includeInactive: true,
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
