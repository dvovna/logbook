import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

@Injectable()
export default class HomeTabActionsHandler {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestViewService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case 'open_vacation_modal': {
        await this.slackCommunicationService.openView(
          this.vacationRequestViewService.getView(
            payload.trigger_id || user.slack_id,
            {
              userId: user.id,
              teamId: user.team_id,
            },
          ),
          user.team_id,
        );

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }
}
