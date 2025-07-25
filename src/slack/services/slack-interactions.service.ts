import { Injectable, Logger } from '@nestjs/common';
import TeamSettingsService from 'src/team-settings/team-settings.service';
import { UsersService } from 'src/users/users.service';
import InteractionActionId from 'src/slack/enums/InteractionActionId';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

export interface ISlackInteractionPayload {
  type: string;
  actions: Array<{
    action_id: InteractionActionId;
    value: string;
  }>;
  state: {
    values: {
      [key: string]: {
        [key: string]: {
          value: string;
        };
      };
    };
  };
  channel: {
    id: string;
  };
  user: {
    id: string;
  };
}

@Injectable()
export default class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  public constructor(
    private readonly teamSettingsService: TeamSettingsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly usersService: UsersService,
  ) {}

  public async handleSlackInteraction(payload: ISlackInteractionPayload) {
    switch (payload.type) {
      case 'block_actions': {
        const action = payload.actions[0];

        if (action.action_id === InteractionActionId.SubmitSettings) {
          const [teamId, userId] = action.value.split('_');

          await this.handleSubmitSettings(payload, userId, teamId);
        }

        break;
      }
      default: {
        this.logger.warn(`Unhandled interaction type: ${payload.type}`);

        break;
      }
    }
  }

  private async handleSubmitSettings(
    { state, channel }: ISlackInteractionPayload,
    userId: string,
    teamId: string,
  ) {
    const vacationDays =
      state.values['vacation_days_block']['vacation_days'].value;
    const bonusDays = state.values['bonus_days_block']['bonus_days'].value;

    const userData = await this.usersService.findOne({
      id: userId,
    });

    if (!userData || userData.team_id !== teamId) {
      this.logger.error(
        `User with ID ${userId} and team_id ${teamId} not found`,
      );

      return;
    }

    const vacationDaysNumber = parseInt(vacationDays, 10);
    const bonusDaysNumber = parseInt(bonusDays, 10);

    if (isNaN(vacationDaysNumber) || isNaN(bonusDaysNumber)) {
      await this.slackCommunicationService.postMessage(
        channel.id,
        { text: 'Invalid input. Please enter numbers only.' },
        teamId,
      );

      return;
    }

    await this.teamSettingsService.update(
      {
        team_id: teamId,
      },
      {
        vacation_days: Number(vacationDays),
        bonus_days: Number(bonusDays),
      },
      userId,
    );

    await this.slackCommunicationService.postMessage(
      channel.id,
      {
        text: `✅ Settings updated successfully!\nVacation Days: ${vacationDaysNumber}, Bonus Days: ${bonusDaysNumber}`,
      },
      teamId,
    );
  }
}
