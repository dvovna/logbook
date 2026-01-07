import { Injectable, Logger } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import UserRole from '@common/enums/user-role.enum';
import { VacationsTabViewActionId } from '@modules/slack/tabs/vacations/enums/vacations-tab-view-action-id.enum';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { VacationsTabService } from '@modules/slack/tabs/vacations/services/vacations-tab.service';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import { VacationsTabModalName } from '@modules/slack/tabs/vacations/enums/vacations-tab-modal-name.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.VacationsTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class VacationsTabActionHandler extends BaseAdminTabActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(VacationsTabActionHandler.name);

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly vacationsTabService: VacationsTabService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [VacationsTabViewActionId.ManagePendingRequestMenu]: withMenuAction(
        this.handleMenuAction,
        this.logger,
      ),
    };
  }

  private handleMenuAction = async (
    actionType: VacationsTabViewActionId,
    entityId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case VacationsTabViewActionId.ApprovePendingRequest: {
        return this.vacationsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationsTabModalName.ApprovePendingRequest,
          { user, stepId: entityId },
        );
      }
      case VacationsTabViewActionId.CommentPendingRequest: {
        return this.vacationsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationsTabModalName.CommentPendingRequest,
          { user, stepId: entityId },
        );
      }
      case VacationsTabViewActionId.RejectPendingRequest: {
        return this.vacationsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationsTabModalName.RejectPendingRequest,
          { user, stepId: entityId },
        );
      }
      case VacationsTabViewActionId.ViewPendingRequestDetails: {
        return this.vacationsTabService.openModal(
          payload.trigger_id || user.slack_id,
          VacationsTabModalName.ViewPendingRequest,
          { user, requestId: entityId },
        );
      }
      default: {
        this.logger.warn(`Unhandled Vacations Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
