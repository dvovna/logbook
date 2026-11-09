import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from '@modules/users/repositories/users.repository';
import { TransactionService } from 'src/database/transaction.service';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { SupabaseFilter } from '@common/repositories/base.repository';
import { UserUpdateValidatorService } from '@modules/users/services/user-update-validator.service';

interface ICreateUserParams {
  email: string;
  name: string;
  role: UserRole;
  slackTeamId: string;
  teamId: string | null;
  slackId: string;
  contractStartDate?: Date | null;
  carryoverDays?: number;
  isActive?: boolean;
  updatedBy?: string;
}

interface IFindParams {
  slackTeamId: string;
  id?: string;
  ids?: string[];
  teamId?: string;
  teamIds?: string[];
  // People in no team.
  withoutTeam?: boolean;
  role?: UserRole;
  roles?: UserRole[];
  slackId?: string;
  isActive?: boolean;
  includeInactive?: boolean;
  email?: string;
}

type ISearchUsersParams = ISearchParams<IFindParams>;

interface IUsersService {
  create(params: ICreateUserParams): Promise<IUserViewModel>;
  findOne(params: IFindParams): Promise<IUserViewModel | null>;
  findMany(params: IFindParams): Promise<IUserViewModel[]>;
  findOneWithValidation(params: IFindParams): Promise<IUserViewModel>;
  search(params: ISearchUsersParams): Promise<ISearchResult<IUserViewModel>>;
  count(params: IFindParams): Promise<number>;
}

@Injectable()
export class UsersService implements IUsersService {
  public constructor(
    private readonly userRepository: UsersRepository,
    private readonly userUpdateValidatorService: UserUpdateValidatorService,
    private readonly transactions: TransactionService,
  ) {}

  public async create({
    email,
    name,
    role = UserRole.Member,
    slackId,
    teamId,
    slackTeamId,
  }: ICreateUserParams) {
    return await this.userRepository.create({
      created_at: new Date().toISOString(),
      email,
      name,
      carryover_days: 0,
      is_active: true,
      team_id: teamId,
      slack_team_id: slackTeamId,
      role,
      slack_id: slackId,
    });
  }

  public async upsert({
    email,
    name,
    role,
    isActive,
    slackId,
    teamId,
    slackTeamId,
    contractStartDate,
  }: ICreateUserParams) {
    return await this.userRepository.upsert(
      {
        email,
        name,
        role,
        is_active: isActive,
        team_id: teamId,
        slack_team_id: slackTeamId,
        slack_id: slackId,
        // Left out when not given, so an upsert keeps the existing date.
        contract_start_date: contractStartDate?.toISOString(),
        updated_at: new Date().toISOString(),
      },
      ['slack_team_id', 'slack_id'],
    );
  }

  public async search(
    params: ISearchUsersParams,
  ): Promise<ISearchResult<IUserViewModel>> {
    return this.userRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
  }

  public getUsersCountByTeam(slackTeamId: string) {
    return this.userRepository.getUsersCountByTeam(slackTeamId);
  }

  // The users `userIds` of the workspace become the team's members; the
  // team's other members leave it. One transaction.
  public setTeamMembers(
    teamId: string,
    userIds: string[],
    updatedBy: IUserViewModel,
  ) {
    return this.transactions.transaction(() =>
      this.userRepository.setTeamMembers({
        slackTeamId: updatedBy.slack_team_id,
        teamId,
        userIds,
        updatedBy: updatedBy.id,
      }),
    );
  }

  public count(params: IFindParams) {
    return this.userRepository.count(this.getFindQuery(params));
  }

  public async update(
    findParams: IFindParams,
    params: Partial<ICreateUserParams>,
    updatedBy?: IUserViewModel,
  ): Promise<IUserViewModel | null> {
    const userBeforeUpdate = await this.findOneWithValidation(findParams);

    await this.userUpdateValidatorService.validate(userBeforeUpdate, params);

    return await this.userRepository.update(this.getFindQuery(findParams), {
      ...this.mapToDbUser(params),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy?.id || null,
    });
  }

  public async bulkCreate(paramsList: ICreateUserParams[]) {
    const users = paramsList.map(
      ({
        email,
        name,
        role,
        slackTeamId,
        teamId,
        slackId,
        contractStartDate,
      }) => ({
        email,
        name,
        is_active: true,
        carryover_days: 0,
        role: role || UserRole.Member,
        team_id: teamId,
        slack_team_id: slackTeamId,
        slack_id: slackId,
        contract_start_date: contractStartDate?.toISOString() || null,
        created_at: new Date().toISOString(),
      }),
    );

    return await this.userRepository.createMany(users);
  }

  public async findOne(
    findParams: IFindParams,
  ): Promise<IUserViewModel | null> {
    return await this.userRepository.findOne(this.getFindQuery(findParams));
  }

  public async findMany(findParams: IFindParams): Promise<IUserViewModel[]> {
    return await this.userRepository.findMany(this.getFindQuery(findParams));
  }

  public async findOneWithValidation(
    findParams: IFindParams,
  ): Promise<IUserViewModel> {
    const user = await this.userRepository.findOne(
      this.getFindQuery(findParams),
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  // A Slack user ID is unique only within a workspace: on Enterprise Grid the
  // same person has the same ID in every workspace of the organization.
  public async findBySlackId(slackId: string, slackTeamId: string) {
    return await this.userRepository.findOne({
      slack_id: slackId,
      slack_team_id: slackTeamId,
    });
  }

  private getFindQuery(findParams: IFindParams): SupabaseFilter {
    return {
      slack_team_id: findParams.slackTeamId,
      ...(findParams.id ? { id: findParams.id } : {}),
      ...(findParams.role ? { role: findParams.role } : {}),
      ...(findParams.roles
        ? {
            role: {
              operator: 'in',
              value: findParams.roles,
            },
          }
        : {}),
      ...(findParams.ids
        ? {
            id: {
              operator: 'in',
              value: findParams.ids,
            },
          }
        : {}),
      ...(findParams.teamId ? { team_id: findParams.teamId } : {}),
      ...(findParams.withoutTeam
        ? { team_id: { operator: 'is', value: null } }
        : {}),
      ...(findParams.teamIds
        ? { team_id: { operator: 'in', value: findParams.teamIds } }
        : {}),
      ...(findParams.slackId ? { slack_id: findParams.slackId } : {}),
      ...(findParams.isActive !== undefined
        ? { is_active: findParams.isActive }
        : { is_active: findParams.includeInactive ? undefined : true }),
      ...(findParams.email ? { email: findParams.email } : {}),
    };
  }

  private mapToDbUser(params: Partial<ICreateUserParams>) {
    return {
      ...(params.name ? { name: params.name } : {}),
      ...(params.email ? { email: params.email } : {}),
      ...(params.teamId ? { team_id: params.teamId } : {}),
      ...(params.role ? { role: params.role } : {}),
      ...(params.contractStartDate
        ? { contract_start_date: params.contractStartDate.toISOString() }
        : {}),
      ...(params.carryoverDays !== undefined
        ? { carryover_days: params.carryoverDays }
        : {}),
      ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
    };
  }
}
