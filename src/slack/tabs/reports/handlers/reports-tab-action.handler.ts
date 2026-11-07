import { ForbiddenException, Injectable } from '@nestjs/common';
import { TIME_ENTRIES_ADMIN_ROLES } from 'src/time-entries/constants/time-entries-admin-roles';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ReportsTabService } from '@modules/slack/tabs/reports/services/reports-tab.service';
import {
  ReportsModalName,
  ReportsTabActionId,
} from '@modules/slack/tabs/reports/enums/reports-modal-name.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ReportsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.Reports),
})
export default class ReportsTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly reportsTabService: ReportsTabService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [ReportsTabActionId.BillingReport]: this.handleBillingReports,
    };
  }

  // Managers see Reports for their week only; the report is Admin's and HR's.
  private handleBillingReports = async (
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    if (!TIME_ENTRIES_ADMIN_ROLES.includes(user.role)) {
      throw new ForbiddenException('Only Admin and HR make billing reports');
    }

    await this.reportsTabService.openModal(
      payload.trigger_id || user.slack_id,
      ReportsModalName.BillingReport,
      { user },
    );
  };
}
