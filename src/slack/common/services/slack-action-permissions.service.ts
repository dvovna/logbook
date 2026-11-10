import { UNLOCK_SNAPSHOT_ROLES } from 'src/billing/constants/snapshot-roles';
import { RATE_ROLES } from 'src/projects/constants/rate-roles';
import { CLIENT_EDITOR_ROLES } from '@common/constants/role-groups';
import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { UsersTabViewActionId } from '@modules/slack/tabs/users/enums/users-tab-view-action-id.enum';
import { VacationRequestsTabViewActionId } from '@modules/slack/tabs/vacation-requests/enums/vacation-requests-tab-view-action-id.enum';
import { ClientsTabViewActionId } from '@modules/slack/tabs/clients/enums/clients-tab-view-actions-id.enum';
import { ProjectsTabViewActionId } from '@modules/slack/tabs/projects/enums/projects-tab-view-actions-id.enum';
import { BillingSnapshotsTabActionId } from '@modules/slack/tabs/billing-snapshots/enums/billing-snapshots-tab-action-id.enum';

// Which role sees an action inside a screen, when not everyone who may open
// the screen (SCREENS) may use it. Hiding is not access control: the
// handlers and services check the role again.
@Injectable()
export class SlackActionPermissionsService {
  private readonly permissions: Record<string, UserRole[]> = {
    [UsersTabViewActionId.ManageUserMenu]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    // A manager may look at a user's vacation usage; only Admin and HR
    // submit the edit and status forms.
    [UsersTabViewActionId.ViewVacationUsage]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [UsersTabViewActionId.EditUser]: [UserRole.Admin, UserRole.HR],
    [UsersTabViewActionId.ChangeStatus]: [UserRole.Admin, UserRole.HR],
    [VacationRequestsTabViewActionId.CreateRequest]: [
      UserRole.Admin,
      UserRole.HR,
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
    // Managers see clients and projects; Admin, HR and Finance change clients,
    // Admin and Finance projects (their form has the rate). A manager or HR
    // may assign people to a project and archive it. Rates are Admin's and
    // Finance's, the currency an admin's.
    [ClientsTabViewActionId.AddClient]: [...CLIENT_EDITOR_ROLES],
    [ClientsTabViewActionId.ManageClientMenu]: [...CLIENT_EDITOR_ROLES],
    [ProjectsTabViewActionId.AddProject]: [...RATE_ROLES],
    [ProjectsTabViewActionId.EditProject]: [...RATE_ROLES],
    [ProjectsTabViewActionId.ManageProjectAssignments]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
    ],
    [ProjectsTabViewActionId.ArchiveProject]: [
      UserRole.Admin,
      UserRole.HR,
      UserRole.Manager,
      UserRole.Finance,
    ],
    [ProjectsTabViewActionId.ManagePersonRates]: [...RATE_ROLES],
    [ProjectsTabViewActionId.ChangeCurrency]: [UserRole.Admin],
    // Admin and Finance make billing snapshots; only an admin unlocks one.
    [BillingSnapshotsTabActionId.UnlockSnapshot]: [...UNLOCK_SNAPSHOT_ROLES],
  } as const;

  public can(
    userRole: UserRole,
    action: keyof typeof this.permissions,
  ): boolean {
    const allowedRoles = this.permissions[action] ?? [];

    return allowedRoles.includes(userRole);
  }
}
