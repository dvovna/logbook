import {
  ActionMapType,
  BaseActionHandler,
} from 'src/slack/common/handlers/base-action.handler';
import { withButtonAction } from 'src/slack/common/utils/view.utils';
import { IUserViewModel } from 'src/users/types/user.interface';
import { FallbackTabViewActionId } from 'src/slack/tabs/fallback/views/fallback-tab.view';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { Injectable } from '@nestjs/common';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.FallbackTabView,
  type: 'block_actions',
})
export class FallbackTabActionHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    private readonly tabNavigationService: TabNavigationService,
  ) {
    super();

    this.actionMap = {
      [FallbackTabViewActionId.Retry]:
        withButtonAction<FallbackTabViewActionId>(this.handleButtonAction),
    };
  }

  private handleButtonAction = (
    _: FallbackTabViewActionId,
    tabId: TabId,
    user: IUserViewModel,
  ) => {
    this.tabNavigationService.navigate(tabId, { user });
  };
}
