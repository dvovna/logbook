import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import SlackUsersService from 'src/slack-communication/services/slack-users.service';
import UserRole from 'src/common/enums/user-role.enum';

interface ISyncUsersParams {
  defaultTeamId: string;
  userSlackIdsToIgnore?: string[];
  slackTeamId: string;
}

@Injectable()
export class TeamUsersSyncService {
  private readonly logger = new Logger(TeamUsersSyncService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly slackUsersService: SlackUsersService,
  ) {}

  public async syncUsers({
    defaultTeamId,
    userSlackIdsToIgnore = [],
    slackTeamId,
  }: ISyncUsersParams) {
    const allUsers = await this.slackUsersService.getExistingUsers(slackTeamId);

    if (allUsers.length === 0) {
      this.logger.warn(`No users found for team ${slackTeamId}`);
      return;
    }

    const usersToCreate = allUsers
      .filter(({ id: slackId }) => !userSlackIdsToIgnore.includes(slackId))
      .map(({ id, email, real_name, profile }) => ({
        slackId: id,
        teamId: defaultTeamId,
        slackTeamId: slackTeamId,
        email: profile.email || email,
        name: real_name || 'Unknown User',
        role: UserRole.Member,
      }));

    await this.usersService.bulkCreate(usersToCreate);

    this.logger.log(
      `Imported ${allUsers.length} users for team ${slackTeamId}`,
    );
  }
}
