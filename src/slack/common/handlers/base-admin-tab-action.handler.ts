import { IUserViewModel } from 'src/users/types/user.interface';
import { ISlackInteractionPayload } from 'src/slack/common/types/slack-interaction-payload.interface';
import {
  BaseActionHandler,
} from 'src/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from 'src/slack/common/services/tab-navigation.service';
import { AdminNavigationActionId } from 'src/slack/common/enums/admin-navigation-action-id';
import { CommonViewActionId } from 'src/slack/enums/common-view-action-id.enum';

export abstract class BaseAdminTabActionHandler extends BaseActionHandler {
  public constructor(
    protected readonly tabNavigationService: TabNavigationService,
  ) {
    super();
  }

  private createOpenTabHandler = (tabId: TabId) => {
    return (_payload: ISlackInteractionPayload, user: IUserViewModel) => {
      this.tabNavigationService.navigate(tabId, { user });
    };
  };

  protected readonly globalActionMap = {
    [CommonViewActionId.BackToHomeTab]: (
      _payload: ISlackInteractionPayload,
      user: IUserViewModel,
    ) => {
      this.tabNavigationService.navigate(TabId.Home, { user });
    },
    [AdminNavigationActionId.ViewHome]: this.createOpenTabHandler(TabId.Home),
    [AdminNavigationActionId.ManageTeams]: this.createOpenTabHandler(
      TabId.Teams,
    ),
    [AdminNavigationActionId.ManageUsers]: this.createOpenTabHandler(
      TabId.Users,
    ),
    [AdminNavigationActionId.ManageVacationRequests]: this.createOpenTabHandler(
      TabId.VacationRequests,
    ),
    [AdminNavigationActionId.ManageVacationPolicies]: this.createOpenTabHandler(
      TabId.VacationPolicies,
    ),
  };
}
