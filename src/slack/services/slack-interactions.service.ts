import { Injectable, Logger } from '@nestjs/common';
import TeamSettingsService from 'src/team-settings/team-settings.service';
import { UsersService } from 'src/users/users.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { IntegrationCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { IViewMetadata } from 'src/slack/types/slack-view-metadata.interface';
import UserRole from 'src/common/enums/user-role.enum';
import SlackUserAccessService from 'src/slack/services/slack-user-access.service';

export interface ISlackInteractionPayload {
  type: string;
  view: {
    team_id: string;
    callback_id: IntegrationCallbackId;
    private_metadata: string;
    state: {
      values: {
        [key: string]: {
          [key: string]: {
            value: string;
          };
        };
      };
    };
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
    private readonly slackUserAccessService: SlackUserAccessService,
  ) {}

  public async handleSlackInteraction(payload: ISlackInteractionPayload) {
    switch (payload.type) {
      case 'view_submission': {
        await this.handleViewSubmission(payload);

        break;
      }
      default: {
        this.logger.warn(`Unhandled interaction type: ${payload.type}`);

        break;
      }
    }
  }

  private async handleViewSubmission(payload: ISlackInteractionPayload) {
    const { callback_id } = payload.view;

    switch (callback_id) {
      case IntegrationCallbackId.ChangeTeamSettings: {
        const metadata = JSON.parse(
          payload.view.private_metadata,
        ) as IViewMetadata;

        await this.handleSubmitSettings(payload, metadata);

        break;
      }
      default: {
        this.logger.warn(
          `Unhandled view submission callback_id: ${callback_id}`,
        );
      }
    }
  }

  private async handleSubmitSettings(
    { view, user }: ISlackInteractionPayload,
    { userId, teamId }: IViewMetadata,
  ) {
    const userData = await this.usersService.findOneWithValidation({
      id: userId,
      teamId,
    });

    await this.slackUserAccessService.checkUserRoleAccess(
      userData,
      UserRole.Admin,
    );

    const { state } = view;

    const vacationDays =
      state.values['vacation_days_block']['vacation_days'].value;
    const bonusDays = state.values['bonus_days_block']['bonus_days'].value;

    const vacationDaysNumber = parseInt(vacationDays, 10);
    const bonusDaysNumber = parseInt(bonusDays, 10);

    if (isNaN(vacationDaysNumber) || isNaN(bonusDaysNumber)) {
      await this.slackCommunicationService.postMessage(
        user.id,
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
      user.id,
      {
        text: `✅ Settings updated successfully!\nVacation Days: ${vacationDaysNumber}, Bonus Days: ${bonusDaysNumber}`,
      },
      teamId,
    );
  }
}
