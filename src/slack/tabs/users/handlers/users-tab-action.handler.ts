import { Injectable, Logger } from '@nestjs/common';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  UsersTabModalName,
  UsersTabService,
} from 'src/slack/tabs/users/services/users-tab.service';
import {
  IUsersTabMetaData,
  UsersTabViewActionId,
} from 'src/slack/tabs/users/views/users-tab.view';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { ActionMapType } from 'src/slack/common/handlers/base-action.handler';
import {
  withSelectFilter,
  withPagination,
} from 'src/slack/common/utils/tab-list.utils';
import { withMenuAction } from 'src/slack/common/utils/slack-menu.utils';
import { TabNavigationService } from 'src/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from 'src/slack/common/handlers/base-admin-tab-action.handler';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.UsersTabView,
  type: 'block_actions',
})
export default class UsersTabActionHandler extends BaseAdminTabActionHandler {
  private readonly logger = new Logger(UsersTabActionHandler.name);

  protected actionMap: ActionMapType;

  public constructor(
    tabNavigationService: TabNavigationService,
    private readonly usersTabService: UsersTabService,
  ) {
    super(tabNavigationService);

    const paginationHandler = withPagination(this.updateTab);

    this.actionMap = {
      [UsersTabViewActionId.ManageUserMenu]: withMenuAction<
        UsersTabViewActionId,
        [IUserViewModel]
      >(this.handleManageUserMenuAction),
      [UsersTabViewActionId.PaginationPrev]: paginationHandler,
      [UsersTabViewActionId.PaginationNext]: paginationHandler,
      [UsersTabViewActionId.FilterUsersByRole]: withSelectFilter(
        'role',
        this.updateTab,
      ),
      [UsersTabViewActionId.FilterUsersByTeam]: withSelectFilter(
        'teamId',
        this.updateTab,
      ),
      [UsersTabViewActionId.FilterUsersByStatus]: withSelectFilter(
        'status',
        this.updateTab,
      ),
    };
  }

  private updateTab = async (
    metadata: IUsersTabMetaData,
    user: IUserViewModel,
  ) => {
    await this.usersTabService.publish({
      user,
      metadata,
    });
  };

  private handleManageUserMenuAction = async (
    actionType: UsersTabViewActionId,
    userId: string,
    payload: ISlackInteractionPayload,
    user: IUserViewModel,
  ) => {
    switch (actionType) {
      case UsersTabViewActionId.EditUser: {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.EditUser,
          { userId, user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      case UsersTabViewActionId.ChangeStatus: {
        await this.usersTabService.openModal(
          payload.trigger_id || user.slack_id,
          UsersTabModalName.ChangeUserStatus,
          { userId, user, pageMetadata: payload.view.private_metadata },
        );

        break;
      }
      default: {
        this.logger.warn(`Unhandled Users Tab Menu actionType: ${actionType}`);
      }
    }
  };
}
