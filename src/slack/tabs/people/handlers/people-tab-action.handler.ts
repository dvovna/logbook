import { Injectable } from '@nestjs/common';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { ActionMapType } from '@modules/slack/common/handlers/base-action.handler';
import { TabNavigationService } from '@modules/slack/common/services/tab-navigation.service';
import { BaseAdminTabActionHandler } from '@modules/slack/common/handlers/base-admin-tab-action.handler';
import UserRole from '@common/enums/user-role.enum';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.PeopleTabView,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export default class PeopleTabActionHandler extends BaseAdminTabActionHandler {
  protected actionMap: ActionMapType;

  public constructor(tabNavigationService: TabNavigationService) {
    super(tabNavigationService);

    this.actionMap = {};
  }
}
