import { Injectable, NotFoundException } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import PrimaryEntityDeleteError from 'src/common/errors/primary-entity-delete.error';
import EntityHasDependenciesError from 'src/common/errors/entity-has-dependencies.error';
import TeamsService from 'src/teams/teams.service';

export const DEFAULT_VACATION_DAYS = 24;
export const DEFAULT_WORK_DAYS = 20;
export const DEFAULT_CARRYOVER_DAYS = 0;
export const DEFAULT_BONUS_DAYS = 3;
const DEFAULT_VACATION_POLICY_NAME = 'Default Vacation Policy';

type IUpdateParams = {
  vacationDays?: number;
  workingDays?: number;
  bonusDays?: number;
  carryoverDays?: number;
  name?: string;
};

type ICreatePolicyParams = {
  name: string;
  slackTeamId: string;
  vacationDays: number;
  workingDays: number;
  bonusDays: number;
  carryoverDays: number;
  isPrimary?: boolean;
};

type IFindParams = {
  id: string;
  slackTeamId: string;
};

const MAX_POLICIES_COUNT = 5;

@Injectable()
export default class VacationPoliciesService {
  public constructor(
    private readonly vacationPoliciesRepository: VacationPoliciesRepository,
    private readonly teamsService: TeamsService,
  ) {}

  public findOne({
    id,
    slackTeamId,
  }: IFindParams): Promise<IVacationPolicyViewModel | null> {
    return this.vacationPoliciesRepository.findOne({
      id,
      slack_team_id: slackTeamId,
    });
  }

  public async findOneWithValidation(params: IFindParams) {
    const policy = await this.vacationPoliciesRepository.findOne({
      slack_team_id: params.slackTeamId,
      id: params.id,
    });

    if (!policy) {
      throw new NotFoundException(`Policy with id ${params.id} not found.`);
    }

    return policy;
  }

  public findMany({
    slackTeamId,
  }: Pick<IFindParams, 'slackTeamId'>): Promise<IVacationPolicyViewModel[]> {
    return this.vacationPoliciesRepository.findMany({
      slack_team_id: slackTeamId,
    });
  }

  public async create(createParams: ICreatePolicyParams, user: IUserViewModel) {
    const policiesCount = await this.vacationPoliciesRepository.count({
      slack_team_id: createParams.slackTeamId,
    });

    if (policiesCount >= MAX_POLICIES_COUNT) {
      throw new MaxItemsCountReachedError(MAX_POLICIES_COUNT, 'policies');
    }

    const createdAt = new Date().toISOString();

    return await this.vacationPoliciesRepository.create({
      name: createParams.name,
      slack_team_id: createParams.slackTeamId,
      vacation_days: createParams.vacationDays,
      working_days: createParams.workingDays,
      bonus_days: createParams.bonusDays,
      carryover_days: createParams.carryoverDays,
      created_at: createdAt,
      updated_at: createdAt,
      created_by: user.id,
      updated_by: user.id,
      is_primary: createParams.isPrimary ?? false,
    });
  }

  public update(
    { id, slackTeamId }: IFindParams,
    {
      vacationDays,
      bonusDays,
      name,
      carryoverDays,
      workingDays,
    }: IUpdateParams,
    user: IUserViewModel,
  ) {
    return this.vacationPoliciesRepository.update(
      {
        id,
        slack_team_id: slackTeamId,
      },
      {
        ...(vacationDays !== undefined ? { vacation_days: vacationDays } : {}),
        ...(bonusDays !== undefined ? { bonus_days: bonusDays } : {}),
        ...(carryoverDays !== undefined
          ? { carryover_days: carryoverDays }
          : {}),
        ...(workingDays !== undefined ? { carryover_days: carryoverDays } : {}),
        ...(name ? { name } : {}),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
    );
  }

  public async delete({ id, slackTeamId }: IFindParams) {
    const policy = await this.findOneWithValidation({ id, slackTeamId });

    if (policy.is_primary) {
      throw new PrimaryEntityDeleteError('policy');
    }

    const teamsCount = await this.teamsService.count({
      vacationPolicyId: policy.id,
      slackTeamId: policy.slack_team_id,
    });

    if (teamsCount > 0) {
      throw new EntityHasDependenciesError('policy', 'teams');
    }

    await this.vacationPoliciesRepository.delete({
      id: policy.id,
      slack_team_id: slackTeamId,
    });

    return policy;
  }

  public createDefaultPolicy(slackTeamId: string, userId?: string) {
    return this.vacationPoliciesRepository.create({
      name: DEFAULT_VACATION_POLICY_NAME,
      slack_team_id: slackTeamId,
      vacation_days: DEFAULT_VACATION_DAYS,
      bonus_days: DEFAULT_BONUS_DAYS,
      working_days: DEFAULT_WORK_DAYS,
      carryover_days: DEFAULT_CARRYOVER_DAYS,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      created_by: userId,
      updated_by: userId,
    });
  }
}
