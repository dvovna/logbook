import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  IVacationPoliciesTabMetaData,
  PolicyTabViewActionId,
} from '@modules/slack/tabs/vacation-policies/views/vacation-policy-tab.view';
import {
  VacationPoliciesTabModalName,
  VacationPoliciesTabService,
} from '@modules/slack/tabs/vacation-policies/services/vacation-policies-tab.service';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import { withPagination } from '@modules/slack/common/utils/tab-list.utils';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationPoliciesTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR],
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
        this.logger,
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
