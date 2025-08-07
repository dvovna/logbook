import { Injectable } from '@nestjs/common';
import TeamSettingsService, {
  DEFAULT_BONUS_DAYS,
  DEFAULT_VACATION_DAYS,
} from 'src/team-settings/team-settings.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import { ViewsOpenArguments } from '@slack/web-api/dist/types/request/views';
import { IntegrationCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

export enum TeamSettingsSubcommand {
  SetSettings = 'set',
  ListSettings = 'list',
}

@Injectable()
export default class TeamSettingsCommandService {
  public constructor(
    private readonly teamSettingsService: TeamSettingsService,
    private readonly slackCommunicationService: SlackCommunicationService,
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
          user.slack_id,
          this.getChangeSettingsModalView(
            triggerId,
            {
              vacationDays:
                teamSettings?.vacation_days || DEFAULT_VACATION_DAYS,
              bonusDays: teamSettings?.bonus_days || DEFAULT_BONUS_DAYS,
            },
            {
              teamId: user.team_id,
              userId: user.id,
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

  public getChangeSettingsModalView(
    triggerId: string,
    { vacationDays, bonusDays }: { vacationDays: number; bonusDays: number },
    metadata: IViewMetadata,
  ): ViewsOpenArguments {
    return {
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: IntegrationCallbackId.ChangeTeamSettings,
        private_metadata: JSON.stringify(metadata),
        title: {
          type: 'plain_text',
          text: 'Team Vacation Settings',
        },
        submit: {
          type: 'plain_text',
          text: 'Save',
        },
        close: {
          type: 'plain_text',
          text: 'Cancel',
        },
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: '👋 Hello! Thank you for installing the Marina Bot.\n\nBefore we get started, please configure the number of vacation and bonus days for your team.',
            },
          },
          {
            type: 'divider',
          },
          {
            type: 'input',
            block_id: 'vacation_days_block',
            label: {
              type: 'plain_text',
              text: 'Number of vacation days per year',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'vacation_days',
              placeholder: {
                type: 'plain_text',
                text: 'e.g. 20',
              },
              initial_value: vacationDays.toString(),
            },
          },
          {
            type: 'input',
            block_id: 'bonus_days_block',
            label: {
              type: 'plain_text',
              text: 'Number of bonus days per year',
            },
            element: {
              type: 'plain_text_input',
              action_id: 'bonus_days',
              initial_value: bonusDays.toString(),
              placeholder: {
                type: 'plain_text',
                text: 'e.g. 3',
              },
            },
          },
        ],
      },
    };
  }
}
