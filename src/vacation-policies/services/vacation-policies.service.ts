import { Injectable, NotFoundException } from '@nestjs/common';
import VacationPoliciesRepository from 'src/vacation-policies/repositories/vacation-policies.repository';
import IVacationPolicyViewModel from 'src/vacation-policies/types/vacation-policy.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  VacationPolicyCreatedEvent,
  VacationPolicyDeletedEvent,
  VacationPolicyUpdatedEvent,
} from 'src/vacation-policies/events/vacation-policy.events';
import VacationPolicyEvent from 'src/vacation-policies/enums/vacation-policy-event.enum';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';
import {
  ISearchParams,
  ISearchResult,
} from 'src/common/types/pagination.types';
import HolidaysService from 'src/holidays/services/holidays.service';
import TeamsService from 'src/teams/services/teams.service';
import EntityHasDependenciesError from 'src/common/errors/entity-has-dependencies.error';

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

interface IFindParams {
  id?: string;
  slackTeamId: string;
}

type ISearchPoliciesParams = ISearchParams<IFindParams>;

interface IVacationPoliciesService {
  findOne(params: IFindParams): Promise<IVacationPolicyViewModel | null>;
  findMany(
    params: Pick<IFindParams, 'slackTeamId'>,
  ): Promise<IVacationPolicyViewModel[]>;
  findOneWithValidation(params: IFindParams): Promise<IVacationPolicyViewModel>;
  create(
    createParams: ICreatePolicyParams,
    user: IUserViewModel,
  ): Promise<IVacationPolicyViewModel>;
  update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IVacationPolicyViewModel>;
  search(
    params: ISearchPoliciesParams,
  ): Promise<ISearchResult<IVacationPolicyViewModel>>;
  delete(findParams: IFindParams): Promise<IVacationPolicyViewModel>;
  createDefaultPolicy(
    slackTeamId: string,
    userId?: string,
  ): Promise<IVacationPolicyViewModel>;
}

@Injectable()
export default class VacationPoliciesService
  implements IVacationPoliciesService
{
  public constructor(
    private readonly vacationPoliciesRepository: VacationPoliciesRepository,
    private readonly holidaysService: HolidaysService,
    private readonly teamsService: TeamsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  public findOne(
    params: IFindParams,
  ): Promise<IVacationPolicyViewModel | null> {
    return this.vacationPoliciesRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(params: IFindParams) {
    const policy = await this.vacationPoliciesRepository.findOne(
      this.getFindQuery(params),
    );

    if (!policy) {
      throw new NotFoundException(`Policy with id ${params.id} not found.`);
    }

    return policy;
  }

  public findMany(params: IFindParams): Promise<IVacationPolicyViewModel[]> {
    return this.vacationPoliciesRepository.findMany(this.getFindQuery(params));
  }

  public async search(params: ISearchPoliciesParams) {
    return this.vacationPoliciesRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  public async create(createParams: ICreatePolicyParams, user: IUserViewModel) {
    const policiesCount = await this.vacationPoliciesRepository.count(
      this.getFindQuery({
        slackTeamId: createParams.slackTeamId,
      }),
    );

    const maxPoliciesCount = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxPoliciesPerSlackTeam,
    );

    if (policiesCount >= maxPoliciesCount) {
      throw new MaxItemsCountReachedError(maxPoliciesCount, 'policies');
    }

    const createdAt = new Date().toISOString();

    const policy = await this.vacationPoliciesRepository.create({
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
    });

    this.eventEmitter.emit(
      VacationPolicyEvent.Created,
      new VacationPolicyCreatedEvent(policy),
    );

    return policy;
  }

  public async update(
    findParams: IFindParams,
    {
      vacationDays,
      bonusDays,
      name,
      carryoverDays,
      workingDays,
    }: IUpdateParams,
    user: IUserViewModel,
  ) {
    const policy = await this.vacationPoliciesRepository.update(
      this.getFindQuery(findParams),
      {
        ...(vacationDays !== undefined ? { vacation_days: vacationDays } : {}),
        ...(bonusDays !== undefined ? { bonus_days: bonusDays } : {}),
        ...(carryoverDays !== undefined
          ? { carryover_days: carryoverDays }
          : {}),
        ...(workingDays !== undefined ? { working_days: workingDays } : {}),
        ...(name ? { name } : {}),
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
    );

    this.eventEmitter.emit(
      VacationPolicyEvent.Updated,
      new VacationPolicyUpdatedEvent(policy),
    );

    return policy;
  }

  public async delete(findParams: IFindParams) {
    const policy = await this.findOneWithValidation(findParams);

    const teamsCount = await this.teamsService.count({
      slackTeamId: policy.slack_team_id,
      vacationPolicyId: policy.id,
    });

    if (teamsCount > 0) {
      throw new EntityHasDependenciesError(
        'policy',
        `used by ${teamsCount} team${teamsCount === 1 ? '' : 's'}`,
      );
    }

    await this.vacationPoliciesRepository.deleteMany(
      this.getFindQuery(findParams),
    );

    await this.holidaysService.deleteMany({
      slackTeamId: policy.slack_team_id,
      vacationPolicyId: policy.id,
    });

    this.eventEmitter.emit(
      VacationPolicyEvent.Deleted,
      new VacationPolicyDeletedEvent(policy.id),
    );

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

  private getFindQuery(params: IFindParams) {
    return {
      ...(params.id ? { id: params.id } : {}),
      slack_team_id: params.slackTeamId,
    };
  }
}
