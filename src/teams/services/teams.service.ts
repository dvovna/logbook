import { IUserViewModel } from 'src/users/types/user.interface';
import { TeamsRepository } from 'src/teams/repositories/teams.repository';
import { Injectable, NotFoundException } from '@nestjs/common';
import MaxItemsCountReachedError from 'src/common/errors/max-items-count-reached.error';
import {
  ISearchParams,
  ISearchResult,
} from 'src/common/types/pagination.types';
import ITeamViewModel from 'src/teams/types/team.interface';
import EnvironmentVariable from 'src/common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { SupabaseFilter } from 'src/common/repositories/base.repository';
import { DuplicateError } from 'src/common/errors/diplicate.error';

interface ICreateTeamParams {
  name: string;
  description?: string;
  vacationPolicyId?: string | null;
  managerApprovers?: string[];
  hrApprovers?: string[];
  approvalNotificationRecipients?: string[];
  managerApproversRule?: ApprovalRule;
  hrApproversRule?: ApprovalRule;
  slackTeamId: string;
  isPrimary?: boolean;
}

interface IFindParams {
  id?: string;
  slackTeamId: string;
  vacationPolicyId?: string;
  isPrimary?: boolean;
  managerApprovers?: string[];
}

interface IUpdateParams {
  name?: string;
  description?: string;
  vacationPolicyId?: string | null;
  managerApprovers?: string[];
  hrApprovers?: string[];
  approvalNotificationRecipients?: string[];
  managerApproversRule?: ApprovalRule;
  hrApproversRule?: ApprovalRule;
}

type ISearchTeamsParams = ISearchParams<IFindParams>;

interface ITeamsService {
  create(
    createParams: ICreateTeamParams,
    user: IUserViewModel,
  ): Promise<ITeamViewModel>;
  findMany(params: IFindParams): Promise<ITeamViewModel[]>;
  findOne(params: IFindParams): Promise<ITeamViewModel | null>;
  findOneWithValidation(params: IFindParams): Promise<ITeamViewModel>;
  search(params: ISearchTeamsParams): Promise<ISearchResult<ITeamViewModel>>;
  update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ): Promise<ITeamViewModel>;
  delete(teamId: string, user: IUserViewModel): Promise<ITeamViewModel>;
  count(params: IFindParams): Promise<number>;
  createDefaultTeam(
    slackTeamId: string,
    vacationPolicyId: string,
  ): Promise<ITeamViewModel>;
}

const DEFAULT_TEAM_NAME = 'Main Team';
const MAX_TEAMS_COUNT = 5;

@Injectable()
export default class TeamsService implements ITeamsService {
  public constructor(
    private readonly teamsRepository: TeamsRepository,
    private readonly config: ConfigService,
  ) {}

  public async findMany(params: IFindParams) {
    return this.teamsRepository.findMany(this.getFindQuery(params));
  }

  public async findOne(params: IFindParams) {
    return this.teamsRepository.findOne(this.getFindQuery(params));
  }

  public async findOneWithValidation(params: IFindParams) {
    const team = await this.teamsRepository.findOne(this.getFindQuery(params));

    if (!team) {
      throw new NotFoundException(`Team with id ${params.id} not found`);
    }

    return team;
  }

  public async search(params: ISearchTeamsParams) {
    return this.teamsRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  public async create(createParams: ICreateTeamParams, user: IUserViewModel) {
    const teamsCount = await this.teamsRepository.count({
      slack_team_id: createParams.slackTeamId,
    });

    const maxTeamsCount = this.config.getOrThrow<number>(
      EnvironmentVariable.MaxTeamsPerSlackTeam,
    );

    if (teamsCount >= maxTeamsCount) {
      throw new MaxItemsCountReachedError(MAX_TEAMS_COUNT, 'teams');
    }

    const createdAt = new Date().toISOString();

    try {
      return await this.teamsRepository.create({
        name: createParams.name,
        description: createParams.description || '',
        slack_team_id: createParams.slackTeamId,
        vacation_policy_id: createParams.vacationPolicyId,
        manager_approvers: createParams.managerApprovers,
        hr_approvers: createParams.hrApprovers,
        approval_notification_recipients:
          createParams.approvalNotificationRecipients,
        manager_approvers_rule:
          createParams.managerApproversRule || ApprovalRule.Any,
        hr_approvers_rule: createParams.hrApproversRule || ApprovalRule.Any,
        created_at: createdAt,
        updated_at: createdAt,
        created_by: user.id,
        updated_by: user.id,
      });
    } catch (error) {
      if (error.message.includes('duplicate key value')) {
        throw new DuplicateError(
          `Team with name '${createParams.name}' already exists.`,
        );
      }

      throw error;
    }
  }

  public update(
    findParams: IFindParams,
    updateParams: IUpdateParams,
    user: IUserViewModel,
  ) {
    return this.teamsRepository.update(this.getFindQuery(findParams), {
      ...(updateParams.name ? { name: updateParams.name } : {}),
      ...(updateParams.description
        ? { description: updateParams.description }
        : {}),
      ...(updateParams.vacationPolicyId
        ? { vacation_policy_id: updateParams.vacationPolicyId }
        : {}),
      ...(updateParams.managerApprovers !== undefined
        ? { manager_approvers: updateParams.managerApprovers }
        : {}),
      ...(updateParams.hrApprovers !== undefined
        ? { hr_approvers: updateParams.hrApprovers }
        : {}),
      ...(updateParams.approvalNotificationRecipients !== undefined
        ? {
          approval_notification_recipients:
            updateParams.approvalNotificationRecipients,
        }
        : {}),
      ...(updateParams.managerApproversRule
        ? { manager_approvers_rule: updateParams.managerApproversRule }
        : {}),
      ...(updateParams.hrApproversRule
        ? { hr_approvers_rule: updateParams.hrApproversRule }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    });
  }

  public async delete(teamId: string, user: IUserViewModel) {
    const team = await this.findOneWithValidation({
      id: teamId,
      slackTeamId: user.slack_team_id,
    });

    await this.teamsRepository.deleteMany({
      id: teamId,
      slack_team_id: user.slack_team_id,
    });

    return team;
  }

  public count(params: IFindParams) {
    return this.teamsRepository.count(this.getFindQuery(params));
  }

  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.managerApprovers !== undefined
        ? {
          manager_approvers: {
            operator: 'ov',
            value: params.managerApprovers,
          },
        }
        : {}),
      slack_team_id: params.slackTeamId,
      ...(params.vacationPolicyId
        ? { vacation_policy_id: params.vacationPolicyId }
        : {}),
    };
  }

  public createDefaultTeam(slackTeamId: string, vacationPolicyId: string) {
    const createdAt = new Date().toISOString();

    return this.teamsRepository.create({
      name: DEFAULT_TEAM_NAME,
      description: '',
      slack_team_id: slackTeamId,
      vacation_policy_id: vacationPolicyId,
      created_at: createdAt,
      updated_at: createdAt,
      created_by: null,
      updated_by: null,
    });
  }
}
