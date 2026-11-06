import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import UserRole from '@common/enums/user-role.enum';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { TimeAndBillingTabService } from '@modules/slack/tabs/time-and-billing/services/time-and-billing-tab.service';
import { TimeAndBillingModalName } from '@modules/slack/tabs/time-and-billing/enums/time-and-billing-modal-name.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.TimeAndBillingTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class TimeAndBillingTabActionHandler extends BaseAdminTabActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly timeAndBillingTabService: TimeAndBillingTabService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [AdminNavigationActionId.ManageBillingReports]: this.handleBillingReports,
    };
  }

  private handleBillingReports = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    await this.timeAndBillingTabService.openModal(
      payload.trigger_id || user.slack_id,
      TimeAndBillingModalName.BillingReport,
      { user },
    );
  };
}
