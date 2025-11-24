import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/views/vacation-requests-tab.view';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';

@Injectable()
export class SlackActionPermissionsService {
  private readonly permissions: Record<string, UserRole[]> = {
    [VacationRequestsTabViewActionId.CreateRequest]: [
      UserRole.Admin,
      UserRole.HR,
    ],
    [AdminNavigationActionId.ViewAdminPanel]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [AdminNavigationActionId.ViewHome]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [AdminNavigationActionId.ManageUsers]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [UsersTabViewActionId.ManageUserMenu]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [AdminNavigationActionId.ManageTeams]: [UserRole.Admin, UserRole.HR],
    [AdminNavigationActionId.ManageVacationRequests]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [VacationRequestsTabViewActionId.DeleteRequest]: [UserRole.Admin],
    [VacationRequestsTabViewActionId.EditRequest]: [
      UserRole.Admin,
      UserRole.HR,
    ],
    [AdminNavigationActionId.ManageVacationPolicies]: [
      UserRole.Admin,
      UserRole.HR,
    ],
  } as const;

  public can(
    userRole: UserRole,
    action: keyof typeof this.permissions,
  ): boolean {
    const allowedRoles = this.permissions[action] ?? [];

    return allowedRoles.includes(userRole);
  }
}
