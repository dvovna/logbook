import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import SlackUsersService from 'src/slack-communication/services/slack-users.service';
import UserRole from 'src/common/enums/user-role.enum';

@Injectable()
export class TeamUsersSyncService {
  private readonly logger = new Logger(TeamUsersSyncService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly slackUsersService: SlackUsersService,
  ) {}

  public async syncUsers(teamId: string, userSlackIdsToIgnore: string[]) {
    const allUsers = await this.slackUsersService.getExistingUsers(teamId);

    if (allUsers.length === 0) {
      this.logger.warn(`No users found for team ${teamId}`);
      return;
    }

    const usersToCreate = allUsers
      .filter(({ id: slackId }) => !userSlackIdsToIgnore.includes(slackId))
      .map(({ id, email, real_name, profile }) => ({
        slackId: id,
        teamId: teamId,
        email: profile.email || email,
        name: real_name || 'Unknown User',
        role: UserRole.Member,
      }));

    await this.usersService.bulkCreate(usersToCreate);

    this.logger.log(`Imported ${allUsers.length} users for team ${teamId}`);
  }
}
