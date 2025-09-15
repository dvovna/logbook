import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  IVacationPoliciesTabMetaData,
  PolicyTabViewActionId,
} from 'src/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
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
import { withPagination } from 'src/slack/common/utils/tab-list.utils';
import { withMenuAction } from 'src/slack/common/utils/slack-menu.utils';

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

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [PolicyTabViewActionId.AddPolicy]: this.handleAddPolicy,
      [PolicyTabViewActionId.ManagePolicyMenu]: withMenuAction(
        this.handleManagePolicyMenuAction,
      ),
      [PolicyTabViewActionId.PaginationPrev]: paginationHandler,
      [PolicyTabViewActionId.PaginationNext]: paginationHandler,
    };
  }

  private updateTab = async (
    metadata: IVacationPoliciesTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.vacationPoliciesTabService.publish({
      user,
      metadata,
    });
  };

  private handleAddPolicy = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.vacationPoliciesTabService.openModal(
      payload.trigger_id || user.slack_id,
      VacationPoliciesTabModalName.CreatePolicy,
      { user, pageMetadata: payload.view.private_metadata },
    );
  };

  private handleManagePolicyMenuAction = async (
    actionType: PolicyTabViewActionId,
    policyId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case PolicyTabViewActionId.EditPolicy: {
        await this.vacationPoliciesTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationPoliciesTabModalName.UpdatePolicy,
          { user, policyId, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case PolicyTabViewActionId.DeletePolicy: {
        await this.vacationPoliciesTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationPoliciesTabModalName.DeletePolicy,
          { user, policyId, pageMetadata: payload.view.private_metadata },
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
