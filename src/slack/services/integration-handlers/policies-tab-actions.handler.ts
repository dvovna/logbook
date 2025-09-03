import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { HomeTabService } from 'src/slack/services/home-tap.service';
import { OverflowAction } from '@slack/bolt';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { PolicyTabViewActionId } from 'src/slack/services/slack-views/tab-views/vacation-policy-tab-view.service';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from 'src/slack/services/vacation-policies-tab.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationPoliciesTabView,
  type: 'block_actions',
})
export default class PoliciesTabActionsHandler {
  private readonly logger = new Logger(PoliciesTabActionsHandler.name);

  public constructor(
    private readonly homeTabService: HomeTabService,
    private readonly vacationPoliciesTabService: VacationPoliciesTabService,
  ) {}

  public async handle(payload: ISlackInteractionPayload, user: IUserViewModel) {
    switch (payload.actions[0].action_id) {
      case PolicyTabViewActionId.AddPolicy: {
        await this.vacationPoliciesTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationPoliciesTabModalName.CreatePolicy,
          { user },
        );

        break;
      }
      case PolicyTabViewActionId.BackToHomeTap: {
        await this.homeTabService.publishHomeTab(user);

        break;
      }
      case PolicyTabViewActionId.ManagePolicyMenu: {
        await this.handleManageTeamMenuAction(payload, user);

        break;
      }
      default: {
        throw new Error(`Unhandled action_id: ${payload.actions[0].action_id}`);
      }
    }
  }

  private async handleManageTeamMenuAction(
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    const selectedValue = (payload.actions[0] as OverflowAction).selected_option
      ?.value;

    if (!selectedValue) {
      this.logger.warn(
        `${PolicyTabViewActionId.ManagePolicyMenu} triggered without selected_option`,
      );

      return;
    }

    // e.g. PolicyTabViewActionId:policy_id
    const [actionType, policyId] = selectedValue.split(':');

    switch (actionType as PolicyTabViewActionId) {
      case PolicyTabViewActionId.EditPolicy: {
        await this.vacationPoliciesTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationPoliciesTabModalName.UpdatePolicy,
          { user, policyId },
        );

        break;
      }
      case PolicyTabViewActionId.DeletePolicy: {
        await this.vacationPoliciesTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationPoliciesTabModalName.DeletePolicy,
          { user, policyId },
        );

        break;
      }
      default: {
        this.logger.warn(
          `Unhandled Vacation Policy Menu actionType: ${actionType}`,
        );
      }
    }
  }
}
