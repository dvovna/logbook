import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { AdminNavigationActionId } from '@modules/slack/common/enums/admin-navigation-action-id';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import {
  VacationRequestsTabViewActionId,
} from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { ClientsTabViewActionId } from '@modules/slack/tabs/clients/enums/clients-tab-view-actions-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';

@Injectable()
export class SlackActionPermissionsService {
  private readonly permissions: Record<string, UserRole[]> = {
    [AdminNavigationActionId.ViewHome]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [AdminNavigationActionId.ViewAdminPanel]: [
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
    [VacationRequestsTabViewActionId.CreateRequest]: [
      UserRole.Admin,
      UserRole.HR,
    ],
    [AdminNavigationActionId.ManageVacationRequests]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [VacationRequestsTabViewActionId.DeleteRequest]: [UserRole.Admin],
    [VacationRequestsTabViewActionId.ApproveOnBehalf]: [
      UserRole.Admin,
      UserRole.HR,
    ],
    [VacationRequestsTabViewActionId.EditRequest]: [
      UserRole.Admin,
      UserRole.HR,
    ],
    [AdminNavigationActionId.ManageVacationPolicies]: [
      UserRole.Admin,
      UserRole.HR,
    ],
    [AdminNavigationActionId.ManagePeople]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [AdminNavigationActionId.ManageTimeAndBilling]: [UserRole.Admin, UserRole.HR, UserRole.Manager],
    [AdminNavigationActionId.ManageProjects]: [UserRole.Admin, UserRole.HR, UserRole.Manager],
    [AdminNavigationActionId.ManageVacations]: [UserRole.Admin, UserRole.HR, UserRole.Manager],
    // Managers see clients and projects; only Admin and HR change them, but a
    // manager may assign people to a project and archive it.
    [ClientsTabViewActionId.AddClient]: [UserRole.Admin, UserRole.HR],
    [ClientsTabViewActionId.ManageClientMenu]: [UserRole.Admin, UserRole.HR],
    [ProjectsTabViewActionId.AddProject]: [UserRole.Admin, UserRole.HR],
    [ProjectsTabViewActionId.EditProject]: [UserRole.Admin, UserRole.HR],
    [ProjectsTabViewActionId.ManageProjectAssignments]: [UserRole.Admin, UserRole.HR, UserRole.Manager],
    [ProjectsTabViewActionId.ArchiveProject]: [UserRole.Admin, UserRole.HR, UserRole.Manager],
    [AdminNavigationActionId.ManageTimeApprovals]: [UserRole.Admin, UserRole.HR, UserRole.Manager],
    [AdminNavigationActionId.ManageBillingReports]: [UserRole.Admin, UserRole.HR],
  } as const;

  public can(
    userRole: UserRole,
    action: keyof typeof this.permissions,
  ): boolean {
    const allowedRoles = this.permissions[action] ?? [];

    return allowedRoles.includes(userRole);
  }
}
