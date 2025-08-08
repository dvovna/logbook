import { Injectable } from '@nestjs/common';
import { UsersService } from 'src/users/users.service';
import TeamSettingsService from 'src/team-settings/team-settings.service';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import UserRole from 'src/common/enums/user-role.enum';
import { TeamSettingsViewService } from 'src/slack/services/slack-views/team-settings-view.service';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';

@Injectable()
export class SubmitTeamSettingsHandler {
  public constructor(
    private readonly usersService: UsersService,
    private readonly teamSettingsService: TeamSettingsService,
    private readonly slackUserAccessService: SlackUserAccessService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly submitTeamSettingsViewService: TeamSettingsViewService,
  ) {}

  public async handle(
    payload: ISlackInteractionPayload,
    metadata: IViewMetadata,
    user: IUserViewModel,
  ) {
    const { view } = payload;
    const { userId, teamId } = metadata;

    await this.slackUserAccessService.checkUserRoleAccess(user, UserRole.Admin);

    try {
      const { vacationDays, bonusDays } =
        this.submitTeamSettingsViewService.extractData(view.state.values);

      await this.teamSettingsService.update(
        { team_id: teamId },
        {
          vacation_days: vacationDays,
          bonus_days: bonusDays,
        },
        userId,
      );

      await this.slackCommunicationService.postMessage(
        user.slack_id,
        {
          text: `✅ Settings updated!\n• Vacation Days: ${vacationDays}\n• Bonus Days: ${bonusDays}`,
        },
        teamId,
      );
    } catch {
      await this.slackCommunicationService.postMessage(
        user.slack_id,
        {
          text: '❌ Invalid input. Please enter valid numbers.',
        },
        teamId,
      );

      return;
    }
  }
}
