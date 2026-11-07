import { Injectable, Logger } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { runInBackground } from '@common/utils/run-in-background';
import delay from '@common/utils/delay';
import AccessTokenService from '@modules/slack-communication/services/slack-access-token.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import SlackUsersService from '@modules/slack-communication/services/slack-users.service';
import {
  TeamUsersSyncService,
} from '@modules/team-setup/team-users-sync.service';

interface ITeamSetupWorkflowParams {
  slackTeamId: string;
  slackTeamName: string;
  teamSlackToken: string;
  slackUserId: string;
}

@Injectable()
export class TeamSetupWorkflowService {
  private readonly logger = new Logger(TeamSetupWorkflowService.name);

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly usersService: UsersService,
    private readonly slackUsersService: SlackUsersService,
    private readonly teamUsersSyncService: TeamUsersSyncService,
    private readonly accessTokenService: AccessTokenService,
  ) {}

  public async execute({
    slackTeamId,
    slackTeamName,
    slackUserId,
    teamSlackToken,
  }: ITeamSetupWorkflowParams): Promise<void> {
    const installed = await this.slackTeamsService.findOne({
      slackId: slackTeamId,
    });

    if (installed) {
      return this.reinstall(installed.id, {
        slackTeamName,
        slackUserId,
        teamSlackToken,
      });
    }

    const slackTeam = await this.slackTeamsService.create({
      slack_id: slackTeamId,
      name: slackTeamName,
      slack_token: teamSlackToken,
    });

    const userProfile = await this.slackUsersService.getUser(
      slackUserId,
      slackTeam.id,
    );

    if (!userProfile.user.profile.email) {
      throw new Error(
        'Email is not available for the authed user. Check scopes and workspace settings.',
      );
    }

    try {
      const adminUser = await this.usersService.create({
        slackId: slackUserId,
        teamId: null,
        slackTeamId: slackTeam.id,
        email: userProfile.user.profile.email,
        name: userProfile.user.profile.real_name || 'Admin User',
        role: UserRole.Admin,
      });

      // no need to sync users instantly
      runInBackground(
        this.logger,
        `sync users of slack team ${slackTeam.id}`,
        async () => {
          await delay(5000);
          await this.teamUsersSyncService.syncUsers({
            slackTeamId: slackTeam.id,
            userSlackIdsToIgnore: [adminUser.slack_id],
          });
        },
      );
    } catch (error) {
      await this.slackTeamsService.delete({ id: slackTeam.id });
      throw error;
    }
  }

  // Installing again (e.g. for new scopes) keeps the workspace's data and
  // roles: it only stores the new token. Whoever reinstalls doesn't become an
  // admin; one who isn't a user yet is added as a member.
  private async reinstall(
    id: string,
    {
      slackTeamName,
      slackUserId,
      teamSlackToken,
    }: Omit<ITeamSetupWorkflowParams, 'slackTeamId'>,
  ) {
    await this.slackTeamsService.updateInstall(id, {
      name: slackTeamName,
      slackToken: teamSlackToken,
    });
    await this.accessTokenService.forget(id);

    if (await this.usersService.findBySlackId(slackUserId, id)) {
      return;
    }

    const { user } = await this.slackUsersService.getUser(slackUserId, id);

    await this.usersService.create({
      slackId: slackUserId,
      teamId: null,
      slackTeamId: id,
      email: user.profile.email!,
      name: user.profile.real_name || 'Unknown User',
      role: UserRole.Member,
    });
  }
}
