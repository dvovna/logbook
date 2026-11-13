import { Injectable, NotFoundException } from '@nestjs/common';
import VacationPoliciesRepository from '@modules/vacation-policies/repositories/vacation-policies.repository';
import IVacationPolicyViewModel from '@modules/vacation-policies/types/vacation-policy.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  VacationPolicyCreatedEvent,
  VacationPolicyDeletedEvent,
  VacationPolicyUpdatedEvent,
} from '@modules/vacation-policies/events/vacation-policy.events';
import VacationPolicyEvent from '@modules/vacation-policies/enums/vacation-policy-event.enum';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { TransactionService } from 'src/database/transaction.service';
import TeamsService from '@modules/teams/services/teams.service';
import { CompanyRulesService } from '@modules/teams/services/company-rules.service';
import { ValidationError } from '@common/errors/validation.error';
import EntityHasDependenciesError from '@common/errors/entity-has-dependencies.error';

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

export interface ICreatedPolicy {
  policy: IVacationPolicyViewModel;
  // The company rules named no policy and now name this one: it applies to
  // everyone who follows them.
  adoptedByCompanyRules: boolean;
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
  ): Promise<ICreatedPolicy>;
  update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<IVacationPolicyViewModel>;
  search(
    params: ISearchPoliciesParams,
  ): Promise<ISearchResult<IVacationPolicyViewModel>>;
  delete(findParams: IFindParams): Promise<IVacationPolicyViewModel>;
}

@Injectable()
export default class VacationPoliciesService implements IVacationPoliciesService {
  public constructor(
    private readonly vacationPoliciesRepository: VacationPoliciesRepository,
    private readonly transactions: TransactionService,
    private readonly teamsService: TeamsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly config: ConfigService,
    private readonly companyRulesService: CompanyRulesService,
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

    const created = await this.transactions.transaction(async () => {
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
      const adoptedByCompanyRules =
        await this.companyRulesService.adoptPolicyIfNone(
          createParams.slackTeamId,
          policy.id,
        );

      return { policy, adoptedByCompanyRules };
    });

    this.eventEmitter.emit(
      VacationPolicyEvent.Created,
      new VacationPolicyCreatedEvent(created.policy),
    );

    return created;
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

  // The checks and the delete in one transaction, under the policy's row
  // lock: a team given the policy meanwhile would otherwise lose it without
  // a word (`ON DELETE SET NULL`). Its holidays go with it (`ON DELETE
  // CASCADE`).
  public async delete({ id, slackTeamId }: IFindParams) {
    if (!id) {
      throw new NotFoundException('Policy not found.');
    }

    const policy = await this.transactions.transaction(async () => {
      const found = await this.vacationPoliciesRepository.findForDelete(
        id,
        slackTeamId,
      );

      if (!found) {
        throw new NotFoundException(`Policy with id ${id} not found.`);
      }

      if (await this.companyRulesService.usesPolicy(id, slackTeamId)) {
        throw new ValidationError(
          'The company rules use this policy. Choose another policy there first.',
        );
      }

      const teamsCount = await this.teamsService.count({
        slackTeamId,
        vacationPolicyId: id,
        ownRulesOnly: true,
      });

      if (teamsCount > 0) {
        throw new EntityHasDependenciesError(
          'policy',
          `used by ${teamsCount} team${teamsCount === 1 ? '' : 's'}`,
        );
      }

      await this.vacationPoliciesRepository.deleteMany(
        this.getFindQuery({ id, slackTeamId }),
      );

      return found;
    });

    this.eventEmitter.emit(
      VacationPolicyEvent.Deleted,
      new VacationPolicyDeletedEvent(policy.id),
    );

    return policy;
  }

  private getFindQuery(params: IFindParams) {
    return {
      ...(params.id ? { id: params.id } : {}),
      slack_team_id: params.slackTeamId,
    };
  }
}
