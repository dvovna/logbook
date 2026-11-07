import { ALL_ROLES } from '@common/constants/role-groups';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { BaseTabActionHandler } from '@modules/slack/common/handlers/base-tab-action.handler';
import { withButtonAction } from '@modules/slack/common/utils/view.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { FallbackTabViewActionId } from '@modules/slack/common/views/fallback-tab.view';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.FallbackTabView,
  type: 'block_actions',
  allowedRoles: ALL_ROLES,
})
// The error view has the navigation too, so it handles it like a tab.
export class FallbackTabActionHandler extends BaseTabActionHandler {
  protected actionMap: ActionMapType;

  public constructor(tabNavigationService: TabNavigationService) {
    super(tabNavigationService);

    this.actionMap = {
      [FallbackTabViewActionId.Retry]: withButtonAction(
        this.handleButtonAction,
      ),
    };
  }

  private handleButtonAction = (tabId: TabId, user: IUserViewModel) => {
    this.tabNavigationService.navigate(tabId, { user });
  };
}
