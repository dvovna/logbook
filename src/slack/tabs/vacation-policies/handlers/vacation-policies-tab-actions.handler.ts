import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { OverflowAction } from '@slack/bolt';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { PolicyTabViewActionId } from 'src/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from 'src/slack/tabs/vacation-policies/services/vacation-policies-tab.service';
import { ActionMapType } from 'src/slack/common/handlers/base-tab-action.handler';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from 'src/slack/common/handlers/base-admin-tab-action.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationPoliciesTabView,
  type: 'block_actions',
})
export default class VacationPoliciesTabActionsHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(VacationPoliciesTabActionsHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    protected readonly tabNavigationService: TabNavigationService,
    private readonly vacationPoliciesTabService: VacationPoliciesTabService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [PolicyTabViewActionId.AddPolicy]: this.handleAddPolicy,
      [PolicyTabViewActionId.ManagePolicyMenu]:
        this.handleManagePolicyMenuAction,
    };
  }

  private handleAddPolicy = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.vacationPoliciesTabService.openModal(
      payload.trigger_id || user.slack_id,
      VacationPoliciesTabModalName.CreatePolicy,
      { user },
    );
  };

  private handleManagePolicyMenuAction = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
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

      case PolicyTabViewActionId.EditHolidays: {
        this.tabNavigationService.navigate(TabId.Holidays, {
          user,
          metadata: {
            filters: {
              policyId,
            },
          },
        });

        break;
      }
      default: {
        this.logger.warn(
          `Unhandled Vacation Policy Menu actionType: ${actionType}`,
        );
      }
    }
  };
}
