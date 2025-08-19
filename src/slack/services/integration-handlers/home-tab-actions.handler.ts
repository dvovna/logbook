import { Injectable } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { VacationRequestViewService } from 'src/slack/services/slack-views/vacation-request-view.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { ViewActionId } from 'src/slack/enums/view-action-id.enum';
import { TeamsTabService } from 'src/slack/services/teams-tab.service';
import { VacationPoliciesTabService } from 'src/slack/services/vacation-policies-tab.service';

@Injectable()
export default class HomeTabActionsHandler {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly vacationRequestViewService: VacationRequestViewService,
    private readonly homeTabService: HomeTabService,
    private readonly manageTeamsTabService: TeamsTabService,
    private readonly vacationPoliciesTabService: VacationPoliciesTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case ViewActionId.OpenVacationModal: {
        await this.slackCommunicationService.openView(
          payload.trigger_id || user.slack_id,
          this.vacationRequestViewService.getView(),
          user.slack_team_id,
        );

        break;
      }
      case ViewActionId.ViewHistory: {
        await this.slackCommunicationService.postEphemeral(
          user.slack_id,
          {
            text: 'This feature is not implemented yet.',
          },
          user.slack_team_id,
        );

        break;
      }
      case ViewActionId.AdminManageTeams: {
        await this.manageTeamsTabService.publishManageTeamsTab(user);

        break;
      }
      case ViewActionId.AdminViewAndEditVacationRequests: {
        await this.homeTabService.publishEditRequestsTab(user);

        break;
      }
      case ViewActionId.AdminViewAndEditVacationPolicies: {
        await this.vacationPoliciesTabService.publishVacationPoliciesTab(user);

        break;
      }
      case ViewActionId.BackToHomeTap: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      case ViewActionId.ManageTeamMenu: {
        console.log('Admin team menu action triggered');
        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }
}
