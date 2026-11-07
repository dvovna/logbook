import { AnyBlock } from '@slack/web-api';
import {
  BaseTabView,
  IBaseTabViewParams,
} from '@modules/slack/common/views/base-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { AdminTabNavigation } from '@modules/slack/common/views/components/admin-tab-navigation.view';
import { SlackActionPermissionsService } from '@modules/slack/common/services/slack-action-permissions.service';
import UserRole from '@common/enums/user-role.enum';

export abstract class BaseAdminTabView<
  GetParams extends IBaseTabViewParams,
  Metadata,
> extends BaseTabView<GetParams, Metadata> {
  protected abstract activeTabActionId: AdminNavigationActionId | null;

  public constructor(
    protected slackActionPermissionsService: SlackActionPermissionsService,
  ) {
    super();
  }

  protected async getTabBlocks(params: GetParams, metadata?: Metadata) {
    return [
      ...this.getNavigation(params),
      ...this.getBackButtonBlocks(params),
      ...this.getTitleBlocks(params),
      ...(await this.getContentBlocks(params, metadata)),
    ];
  }

  private getNavigation(params: GetParams): AnyBlock[] {
    const canViewNavigation = this.slackActionPermissionsService.can(
      params.userRole,
      AdminNavigationActionId.ViewAdminPanel,
    );

    return canViewNavigation
      ? AdminTabNavigation.getNavigationBlocks(
          this.activeTabActionId,
          (tabActionId) => this.canViewTab(tabActionId, params.userRole),
        )
      : [];
  }

  private canViewTab(tabActionId: AdminNavigationActionId, userRole: UserRole) {
    return this.slackActionPermissionsService.can(userRole, tabActionId);
  }
}
