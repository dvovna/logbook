import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { TabId } from '@modules/slack/common/enums/tab-id.enum';
import { rolesOfTab } from '@modules/slack/common/navigation/screens';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { withMenuAction } from '@modules/slack/common/utils/slack-menu.utils';
import {
  MyReceiptsActionId,
  MyReceiptsModalName,
} from '@modules/slack/tabs/my-receipts/enums/my-receipts-action-id.enum';
import { MyReceiptsTabService } from '@modules/slack/tabs/my-receipts/services/my-receipts-tab.service';

// The receipt ID comes from the menu, so from the client: the service looks
// it up among the viewer's own receipts.
@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.MyReceiptsTabView,
  type: 'block_actions',
  allowedRoles: rolesOfTab(TabId.MyReceipts),
})
export class MyReceiptsTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;
  private readonly logger = new Logger(MyReceiptsTabActionHandler.name);

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly myReceiptsTabService: MyReceiptsTabService,
  ) {
    super(tabNavigationService);

    this.actionMap = {
      [MyReceiptsActionId.ManageReceiptMenu]: withMenuAction<
        MyReceiptsActionId,
        [IUserViewModel]
      >(this.handleMenuAction, this.logger),
    };
  }

  private handleMenuAction = async (
    actionType: MyReceiptsActionId,
    receiptId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case MyReceiptsActionId.EditReceipt:
        return this.openModal(
          MyReceiptsModalName.Edit,
          receiptId,
          payload,
          user,
        );
      case MyReceiptsActionId.DeleteReceipt:
        return this.openModal(
          MyReceiptsModalName.Delete,
          receiptId,
          payload,
          user,
        );
      default:
        this.logger.warn(`Unhandled receipt menu action: ${actionType}`);
    }
  };

  private async openModal(
    modalName: MyReceiptsModalName,
    receiptId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) {
    await this.myReceiptsTabService.openModal(
      payload.trigger_id || user.slack_id,
      modalName,
      { user, receiptId, pageMetadata: payload.view.private_metadata },
    );
  }
}
