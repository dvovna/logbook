import { Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
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
