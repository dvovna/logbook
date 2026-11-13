import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';
import { ValidationError } from '@common/errors/validation.error';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';

// What the rule fields of the team form and the company rules form take
// from the client: IDs that have to be the workspace's, approvers that have
// to be allowed to approve.
@Injectable()
export class RuleInputsValidationService {
  public constructor(
    private readonly vacationPoliciesService: VacationPoliciesService,
    private readonly usersService: UsersService,
  ) {}

  public async assertPolicyInWorkspace(
    policyId: string | null | undefined,
    user: IUserViewModel,
  ) {
    if (
      policyId &&
      !(await this.vacationPoliciesService.findOne({
        id: policyId,
        slackTeamId: user.slack_team_id,
      }))
    ) {
      throw new ValidationError(
        'This vacation policy is not in this workspace.',
        'policy',
      );
    }
  }

  // Level 1 holds people of the workspace who can decide a step (active,
  // with an approving role): the form offers managers and admins, and keeps
  // a chosen lead who is HR, as the team file may make one.
  public async assertLevel1Approvers(slackIds: string[], user: IUserViewModel) {
    if (!slackIds.length) {
      return;
    }

    const allowed = new Set(
      (
        await this.usersService.findMany({
          slackTeamId: user.slack_team_id,
          roles: [...MANAGER_ROLES],
        })
      ).map(({ slack_id }) => slack_id),
    );

    if (slackIds.some((slackId) => !allowed.has(slackId))) {
      throw new ValidationError(
        'Level 1 approvers need the Manager, HR or Admin role.',
        'manager_approvers',
      );
    }
  }

  // The select offers everyone in Slack: a decision goes only to active
  // people of the workspace.
  public async assertRecipients(slackIds: string[], user: IUserViewModel) {
    if (!slackIds.length) {
      return;
    }

    const active = await this.usersService.findMany({
      slackTeamId: user.slack_team_id,
      slackIds,
    });

    if (active.length < new Set(slackIds).size) {
      throw new ValidationError(
        'Notification recipients need to be active people in Logbook.',
        'approval_notification_recipients',
      );
    }
  }

  public async assertLevel2Approvers(slackIds: string[], user: IUserViewModel) {
    if (!slackIds.length) {
      return;
    }

    const allowed = new Set(
      (
        await this.usersService.findMany({
          slackTeamId: user.slack_team_id,
          roles: [UserRole.HR, UserRole.Admin],
        })
      ).map(({ slack_id }) => slack_id),
    );

    if (slackIds.some((slackId) => !allowed.has(slackId))) {
      throw new ValidationError(
        'Level 2 approvers need the HR or Admin role.',
        'hr_approvers',
      );
    }
  }
}
