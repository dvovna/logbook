import { Injectable } from '@nestjs/common';
import TeamSettingsService, {
  DEFAULT_BONUS_DAYS,
  DEFAULT_VACATION_DAYS,
} from 'src/team-settings/team-settings.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { TeamSettingsViewService } from 'src/slack/services/slack-views/team-settings-view.service';

export enum TeamSettingsSubcommand {
  SetSettings = 'set',
  ListSettings = 'list',
}

@Injectable()
export default class TeamSettingsCommandService {
  public constructor(
    private readonly teamSettingsService: TeamSettingsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly submitTeamSettingsViewService: TeamSettingsViewService,
  ) {}

  public async handleCommand(
    subcommand: TeamSettingsSubcommand | unknown,
    triggerId: string,
    user: IUserViewModel,
  ) {
    switch (subcommand) {
      case TeamSettingsSubcommand.ListSettings: {
        const settings = await this.teamSettingsService.getByTeamId(
          user.team_id,
        );

        const message = settings
          ? `Your team has the following settings: \n Vacation Days - ${settings.vacation_days} \n Bonus Days - ${settings.bonus_days}`
          : 'No settings found for your team. Please contact an admin.';

        await this.slackCommunicationService.postMessage(
          user.slack_id,
          { text: message },
          user.team_id,
        );

        break;
      }
      case TeamSettingsSubcommand.SetSettings: {
        const teamSettings = await this.teamSettingsService.getByTeamId(
          user.team_id,
        );

        await this.slackCommunicationService.openView(
          this.submitTeamSettingsViewService.getView(
            triggerId,
            {
              teamId: user.team_id,
              userId: user.id,
            },
            {
              vacationDays:
                teamSettings?.vacation_days || DEFAULT_VACATION_DAYS,
              bonusDays: teamSettings?.bonus_days || DEFAULT_BONUS_DAYS,
            },
          ),
          user.team_id,
        );

        break;
      }
      default: {
        await this.slackCommunicationService.postMessage(
          user.slack_id,
          { text: 'Unknown command. Use `/settings set` or `/settings list`.' },
          user.team_id,
        );
      }
    }
  }
}
