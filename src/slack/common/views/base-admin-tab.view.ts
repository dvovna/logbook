import { AnyBlock } from '@slack/web-api';
import {
  BaseTabView,
  IBaseTabViewParams,
} from 'src/slack/common/views/base-tab.view';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { AdminTabNavigation } from 'src/slack/common/views/admin-tab-navigation.view';

export abstract class BaseAdminTabView<
  GetParams extends IBaseTabViewParams,
  Metadata,
> extends BaseTabView<GetParams, Metadata> {
  protected abstract activeTabActionId: AdminNavigationActionId | null;

  protected async getTabBlocks(params: GetParams, metadata?: Metadata) {
    return [
      ...this.getAdminNavigation(),
      ...this.getTitleBlocks(params),
      ...(await this.getContentBlocks(params, metadata)),
    ];
  }

  private getAdminNavigation(): AnyBlock[] {
    return AdminTabNavigation.getNavigationBlocks(this.activeTabActionId);
  }
}
