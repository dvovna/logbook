import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import TeamsService from '@modules/teams/services/teams.service';
import VacationPoliciesService from '@modules/vacation-policies/services/vacation-policies.service';
import { UsersRepository } from '@modules/users/repositories/users.repository';

interface IUpdateUserParams {
  role?: UserRole;
  isActive?: boolean;
  carryoverDays?: number;
}

@Injectable()
export class UserUpdateValidatorService {
  public constructor(
    private readonly usersRepository: UsersRepository,
    private readonly teamsService: TeamsService,
    private readonly vacationPoliciesService: VacationPoliciesService,
  ) {}

  public async validate(
    userBeforeUpdate: IUserViewModel,
    params: IUpdateUserParams,
  ): Promise<void> {
    await this.validateRoleChange(userBeforeUpdate, params);
    await this.validateCarryoverDays(userBeforeUpdate, params);
  }

  private async validateRoleChange(
    userBeforeUpdate: IUserViewModel,
    params: IUpdateUserParams,
  ) {
    const isCurrentRoleAdmin = userBeforeUpdate.role === UserRole.Admin;
    const roleChangedToNonAdmin = params.role !== UserRole.Admin;
    const deactivated = params.isActive === false;

    if (isCurrentRoleAdmin && (roleChangedToNonAdmin || deactivated)) {
      const adminCount = await this.usersRepository.count({
        slack_team_id: userBeforeUpdate.slack_team_id,
        role: UserRole.Admin,
        is_active: true,
      });

      if (adminCount <= 1) {
        throw new ValidationError(
          'Cannot update user. At least one active admin is required.',
        );
      }
    }
  }

  private async validateCarryoverDays(
    userBeforeUpdate: IUserViewModel,
    params: IUpdateUserParams,
  ) {
    if (
      !params.carryoverDays ||
      params.carryoverDays === userBeforeUpdate.carryover_days ||
      !userBeforeUpdate.team_id
    ) {
      return;
    }

    const team = await this.teamsService.findOne({
      slackTeamId: userBeforeUpdate.slack_team_id,
      id: userBeforeUpdate.team_id,
    });

    if (!team?.vacation_policy_id) return;

    const policy = await this.vacationPoliciesService.findOne({
      slackTeamId: userBeforeUpdate.slack_team_id,
      id: team.vacation_policy_id,
    });

    if (!policy) return;

    if (params.carryoverDays > policy.carryover_days) {
      throw new ValidationError(
        `Cannot set carryover days to ${params.carryoverDays}. Maximum allowed is ${policy.carryover_days}.`,
      );
    }
  }
}
