import { Injectable, Logger } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { runInBackground } from '@common/utils/run-in-background';
import delay from '@common/utils/delay';
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
  ) {}

  public async execute({
    slackTeamId,
    slackTeamName,
    slackUserId,
    teamSlackToken,
  }: ITeamSetupWorkflowParams): Promise<void> {
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
}
