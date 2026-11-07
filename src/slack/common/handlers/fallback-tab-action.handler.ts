import { ALL_ROLES } from '@common/constants/role-groups';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
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
export class FallbackTabActionHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();

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
