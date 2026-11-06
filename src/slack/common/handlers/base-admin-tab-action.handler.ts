import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISlackInteractionPayload } from '@modules/slack/common/types/slack-interaction-payload.interface';
import { BaseActionHandler } from '@modules/slack/common/handlers/base-action.handler';
import {
  TabId,
  TabNavigationService,
} from '@modules/slack/common/services/tab-navigation.service';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { CommonViewActionId } from '@modules/slack/enums/common-view-action-id.enum';

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
    [AdminNavigationActionId.ManagePeople]: this.createOpenTabHandler(
      TabId.People,
    ),
    [AdminNavigationActionId.ManageTimeAndBilling]: this.createOpenTabHandler(
      TabId.TimeAndBilling,
    ),
    [AdminNavigationActionId.ManageVacations]: this.createOpenTabHandler(
      TabId.Vacations,
    ),
    [AdminNavigationActionId.ManageVacationRequests]: this.createOpenTabHandler(
      TabId.VacationRequests,
    ),
    [AdminNavigationActionId.ManageVacationPolicies]: this.createOpenTabHandler(
      TabId.VacationPolicies,
    ),
    [AdminNavigationActionId.ManageProjects]: this.createOpenTabHandler(
      TabId.Projects,
    ),
    [AdminNavigationActionId.ManageClients]: this.createOpenTabHandler(
      TabId.Clients,
    ),
    [AdminNavigationActionId.ManageTimeLogs]: this.createOpenTabHandler(
      TabId.TimeEntries,
    ),
    [AdminNavigationActionId.ManageTimeApprovals]: this.createOpenTabHandler(
      TabId.TimeApprovals,
    ),
  };
}
