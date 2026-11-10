import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '@modules/users/services/users.service';
import SlackUsersService from '@modules/slack-communication/services/slack-users.service';
import UserRole from '@common/enums/user-role.enum';

interface ISyncUsersParams {
  userSlackIdsToIgnore?: string[];
  slackTeamId: string;
}

// Imports the workspace's Slack members: after an install, and after a
// reinstall that restores an uninstalled workspace. It adds only the members
// Logbook doesn't have yet, so it is safe to run again: the users it has
// keep their role, team and status, and their profile changes come with
// user_change.
@Injectable()
export class TeamUsersSyncService {
  private readonly logger = new Logger(TeamUsersSyncService.name);

  public constructor(
    private readonly usersService: UsersService,
    private readonly slackUsersService: SlackUsersService,
  ) {}

  public async syncUsers({
    userSlackIdsToIgnore = [],
    slackTeamId,
  }: ISyncUsersParams) {
    const [members, users] = await Promise.all([
      this.slackUsersService.getExistingUsers(slackTeamId),
      this.usersService.findMany({ slackTeamId, includeInactive: true }),
    ]);

    if (members.length === 0) {
      this.logger.warn(`No users found for team ${slackTeamId}`);
      return;
    }

    const knownSlackIds = new Set(users.map(({ slack_id }) => slack_id));
    // Two users of a workspace can't share an email
    // (users_slack_team_id_email_key): a member whose email a user already
    // has, e.g. under an older Slack account, is left out.
    const knownEmails = new Set(users.map(({ email }) => email.toLowerCase()));

    const usersToCreate = members
      .filter(({ id }) => !userSlackIdsToIgnore.includes(id))
      .filter(({ id }) => !knownSlackIds.has(id))
      .map(({ id, email, real_name, profile }) => ({
        slackId: id,
        teamId: null,
        slackTeamId,
        email: profile.email || email,
        name: real_name || 'Unknown User',
        role: UserRole.Member,
      }))
      .filter(({ email }) => !knownEmails.has(email.toLowerCase()));

    await this.usersService.bulkCreate(usersToCreate);

    this.logger.log(
      `Imported ${usersToCreate.length} new of ${members.length} members for team ${slackTeamId}`,
    );
  }
}
