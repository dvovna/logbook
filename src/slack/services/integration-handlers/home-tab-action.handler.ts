import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationRequestModalViewService } from 'src/slack/services/slack-views/modal-views/vacation-request-modal-view.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { TeamsTabService } from 'src/slack/services/teams-tab.service';
import { VacationPoliciesTabService } from 'src/slack/services/vacation-policies-tab.service';
import { UsersTabService } from 'src/slack/services/users-tab.service';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ISlackInteractionHandler } from 'src/slack/services/integration-handlers/slack-interaction.handler';
import { HomeTabActionId } from 'src/slack/services/slack-views/tab-views/home-tap-view.service';
import { HolidaysTabService } from 'src/slack/services/holidays-tab.service';

@Injectable()
@SlackHandler({ callbackId: ViewCallbackId.HomeTabView, type: 'block_actions' })
export default class HomeTabActionHandler implements ISlackInteractionHandler {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestModalViewService,
    private readonly homeTabService: HomeTabService,
    private readonly teamsTabService: TeamsTabService,
    private readonly holidaysTabService: HolidaysTabService,
    private readonly usersTabService: UsersTabService,
    private readonly vacationPoliciesTabService: VacationPoliciesTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case HomeTabActionId.OpenVacationModal: {
        await this.slackCommunicationService.openView(
          payload.trigger_id || user.slack_id,
          this.vacationRequestViewService.getView(),
          user.slack_team_id,
        );

        break;
      }
      case HomeTabActionId.ViewHistory: {
        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          {
            text: 'This feature is not implemented yet.',
          },
          user.slack_team_id,
        );

        break;
      }
      case HomeTabActionId.ManageTeams: {
        await this.teamsTabService.publish({ user });

        break;
      }
      case HomeTabActionId.ManageUsers: {
        await this.usersTabService.publish({ user });

        break;
      }
      case HomeTabActionId.ManageVacationRequests: {
        await this.homeTabService.publishEditRequestsTab(user);

        break;
      }
      case HomeTabActionId.ManageVacationPolicies: {
        await this.vacationPoliciesTabService.publish({ user });

        break;
      }
      case HomeTabActionId.BackToHomeTap: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }
}
