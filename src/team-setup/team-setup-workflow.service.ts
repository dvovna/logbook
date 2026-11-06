import { Injectable, Logger } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import { SlackTeamsService } from 'src/slack-teams/slack-teams.service';
import { UsersService } from 'src/users/services/users.service';
import SlackUsersService from 'src/slack-communication/services/slack-users.service';
import { TeamUsersSyncService } from 'src/team-setup/team-users-sync.service';

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
      setTimeout(() => {
        this.teamUsersSyncService
          .syncUsers({
            slackTeamId: slackTeam.id,
            userSlackIdsToIgnore: [adminUser.slack_id],
          })
          .catch((error: Error) => {
            this.logger.error(
              `Failed to sync users of slack team ${slackTeam.id}: ${error.message}`,
              error.stack,
            );
          });
      }, 5000);
    } catch (error) {
      await this.slackTeamsService.delete({ id: slackTeam.id });
      throw error;
    }
  }
}
