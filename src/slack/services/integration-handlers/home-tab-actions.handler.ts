import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';

@Injectable()
export default class HomeTabActionsHandler {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestViewService,
    private readonly homeTabService: HomeTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case ViewActionId.OpenVacationModal: {
        await this.slackCommunicationService.openView(
          this.vacationRequestViewService.getView(
            payload.trigger_id || user.slack_id,
            {
              userId: user.id,
              teamId: user.slack_team_id,
            },
          ),
          user.slack_team_id,
        );

        break;
      }
      case ViewActionId.ViewHistory: {
        await this.slackCommunicationService.postMessage(
          user.slack_id,
          {
            text: 'This feature is not implemented yet.',
          },
          user.slack_team_id,
        );

        break;
      }
      case ViewActionId.AdminManageTeams: {
        await this.homeTabService.publishManageTeamsTab(user);

        break;
      }
      case ViewActionId.AdminViewAndEditVacationRequests: {
        await this.homeTabService.publishEditRequestsTab(user);

        break;
      }
      case ViewActionId.AdminBackMain: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }
}
