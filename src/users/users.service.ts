import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from 'src/users/users.repository';
import UserRole from 'src/common/enums/user-role.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import {
  ISearchResult,
  ISearchParams,
} from 'src/common/types/pagination.types';
import { SupabaseFilter } from 'src/common/repositories/base.repository';

interface ICreateUserParams {
  email: string;
  name: string;
  role: UserRole;
  slackTeamId: string;
  teamId: string | null;
  slackId: string;
  contractStartDate?: string;
  carryoverDays?: number;
  isActive?: boolean;
  updatedBy?: string;
}

interface IFindParams {
  slackTeamId: string;
  id?: string;
  teamId?: string;
  teamIds?: string[];
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
  public constructor(private readonly userRepository: UsersRepository) {}

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
  }: ICreateUserParams) {
    return await this.userRepository.upsert({
      created_at: new Date().toISOString(),
      email,
      name,
      role,
      is_active: isActive,
      team_id: teamId,
      slack_team_id: slackTeamId,
      slack_id: slackId,
    });
  }

  public async updateMany(
    findParams: IFindParams,
    params: Partial<ICreateUserParams>,
  ) {
    return await this.userRepository.updateMany(this.getFindQuery(findParams), {
      ...(params.role ? { role: params.role } : {}),
      ...(params.name ? { name: params.name } : {}),
      ...(params.email ? { email: params.email } : {}),
      ...(params.teamId ? { team_id: params.teamId } : {}),
      ...(params.contractStartDate
        ? { contract_start_date: params.contractStartDate }
        : {}),
      ...(params.carryoverDays ? { carryover_days: params.carryoverDays } : {}),
      ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
      updated_at: new Date().toISOString(),
      updated_by: params.updatedBy || null,
    });
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

  public count(params: IFindParams) {
    return this.userRepository.count(this.getFindQuery(params));
  }

  public async update(
    findParams: IFindParams,
    params: Partial<ICreateUserParams>,
    updatedBy?: IUserViewModel,
  ): Promise<IUserViewModel | null> {
    return await this.userRepository.update(this.getFindQuery(findParams), {
      ...(params.role ? { role: params.role } : {}),
      ...(params.name ? { name: params.name } : {}),
      ...(params.email ? { email: params.email } : {}),
      ...(params.teamId ? { team_id: params.teamId } : {}),
      ...(params.contractStartDate
        ? { contract_start_date: params.contractStartDate }
        : {}),
      ...(params.carryoverDays ? { carryover_days: params.carryoverDays } : {}),
      ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
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
        carryover_days: 0,
        role: role || UserRole.Member,
        team_id: teamId,
        slack_team_id: slackTeamId,
        slack_id: slackId,
        contract_start_date: contractStartDate || null,
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

  public async findBySlackId(slackId: string) {
    return await this.userRepository.findOne({
      slack_id: slackId,
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
      ...(findParams.teamId ? { team_id: findParams.teamId } : {}),
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
}
