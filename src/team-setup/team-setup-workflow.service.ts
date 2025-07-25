import { Injectable } from '@nestjs/common';
import UserRole from 'src/common/enums/user-role.enum';
import SlackPromptsService from 'src/slack-communication/services/slack-prompts.service';
import { TeamsService } from 'src/teams/teams.service';
import { UsersService } from 'src/users/users.service';
import TeamSettingsService from 'src/team-settings/team-settings.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
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
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
    private readonly teamSettingsService: TeamSettingsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly slackPromptsService: SlackPromptsService,
    private readonly slackUsersService: SlackUsersService,
    private readonly teamUsersSyncService: TeamUsersSyncService,
  ) {}

  public async execute({
    slackTeamId,
    slackTeamName,
    slackUserId,
    teamSlackToken,
  }: ITeamSetupWorkflowParams): Promise<void> {
    const team = await this.teamsService.create({
      slack_id: slackTeamId,
      name: slackTeamName,
      slack_token: teamSlackToken,
    });

    const userProfile = await this.slackUsersService.getUser(
      slackUserId,
      team.id,
    );

    if (!userProfile.user.profile.email) {
      throw new Error(
        'Email is not available for the authed user. Check scopes and workspace settings.',
      );
    }

    try {
      const adminUser = await this.usersService.create({
        slackId: slackUserId,
        teamId: team.id,
        email: userProfile.user.profile.email,
        name: userProfile.user.profile.real_name || 'Admin User',
        role: UserRole.Admin,
      });

      await this.teamSettingsService.createDefaultSettings(
        team.id,
        adminUser.id,
      );

      await this.slackCommunicationService.postMessage(
        adminUser.slack_id,
        this.slackPromptsService.getChangeSettingsPromptMessage({
          teamId: team.id,
          userId: adminUser.id,
        }),
        team.id,
      );

      // no need to sync users instantly
      setTimeout(() => {
        this.teamUsersSyncService.syncUsers(team.id, [adminUser.slack_id]);
      }, 5000);
    } catch (error) {
      await this.teamsService.delete(team.id);
      throw error;
    }
  }
}
