import { IUserViewModel } from '@modules/users/types/user.interface';
import { TeamsRepository } from '@modules/teams/repositories/teams.repository';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { isPeopleAdmin } from '@modules/users/utils/people-admin-roles';
import MaxItemsCountReachedError from '@common/errors/max-items-count-reached.error';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import ITeamViewModel from '@modules/teams/types/team.interface';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { ConfigService } from '@nestjs/config';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { DuplicatedRecordError } from '@common/errors/duplicated-record.error';

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
  name?: string;
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
}

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

  // The teams whose people and vacations `user` manages: null means all of
  // them (Admin, HR); a manager has the teams that list them as a manager
  // approver; anyone else none.
  public async findManagedTeamIds(
    user: IUserViewModel,
  ): Promise<string[] | null> {
    if (isPeopleAdmin(user.role)) {
      return null;
    }

    if (user.role !== UserRole.Manager) {
      return [];
    }

    const teams = await this.findMany({
      slackTeamId: user.slack_team_id,
      managerApprovers: [user.slack_id],
    });

    return teams.map(({ id }) => id);
  }

  // Narrows a team filter to the teams `user` manages: the team IDs a list
  // may show, or undefined for no limit.
  public async scopeTeamFilter(
    user: IUserViewModel,
    teamId?: string,
  ): Promise<string[] | undefined> {
    const managedTeamIds = await this.findManagedTeamIds(user);

    if (managedTeamIds === null) {
      return teamId ? [teamId] : undefined;
    }

    return teamId
      ? managedTeamIds.filter((id) => id === teamId)
      : managedTeamIds;
  }

  public async assertManagesTeam(user: IUserViewModel, teamId: string | null) {
    const managedTeamIds = await this.findManagedTeamIds(user);

    if (managedTeamIds !== null && !managedTeamIds.includes(teamId ?? '')) {
      throw new ForbiddenException(
        'You can only see the people of your teams.',
      );
    }
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
      throw new MaxItemsCountReachedError(maxTeamsCount, 'teams');
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
        throw new DuplicatedRecordError(
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

  private getFindQuery(params: IFindParams): RepositoryFilter {
    return {
      ...(params.id ? { id: params.id } : {}),
      ...(params.name ? { name: params.name } : {}),
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
}
