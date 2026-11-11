import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsersRepository } from '@modules/users/repositories/users.repository';
import { TransactionService } from 'src/database/transaction.service';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { UserUpdateValidatorService } from '@modules/users/services/user-update-validator.service';
import {
  USER_TEAM_CHANGED,
  UserTeamChangedEvent,
} from '@modules/users/events/users.events';
import { ITeamAssignment } from '@modules/users/types/team-assignment.interface';

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
    private readonly eventEmitter: EventEmitter2,
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

  // Never writes the team: a user read before the upsert could carry a team
  // that an admin has changed since. A new user is in no team.
  public async upsert({
    email,
    name,
    role,
    isActive,
    slackId,
    slackTeamId,
    contractStartDate,
  }: Omit<ICreateUserParams, 'teamId'>) {
    return await this.userRepository.upsert(
      {
        email,
        name,
        role,
        is_active: isActive,
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
    return this.transactions.transaction(async () => {
      const changed = await this.userRepository.setTeamMembers({
        slackTeamId: updatedBy.slack_team_id,
        teamId,
        userIds,
        updatedBy: updatedBy.id,
      });

      this.tellTeamChanges(changed, updatedBy.id);
    });
  }

  // Many users at once, in one transaction. A team of another workspace is
  // refused, as update refuses it.
  public async assignTeams(
    assignments: ITeamAssignment[],
    updatedBy: IUserViewModel,
  ): Promise<void> {
    if (assignments.length === 0) {
      return;
    }

    await this.transactions.transaction(async () => {
      const moved = await this.userRepository.assignTeams({
        slackTeamId: updatedBy.slack_team_id,
        assignments,
        updatedBy: updatedBy.id,
      });

      this.tellTeamChanges(moved, updatedBy.id);
    });
  }

  // Puts people back in the team they had, each only while they are still
  // in `from`. Returns the users that moved.
  public async restoreTeams(
    restores: { userId: string; from: string | null; to: string | null }[],
    updatedBy: IUserViewModel,
  ): Promise<IUserViewModel[]> {
    if (restores.length === 0) {
      return [];
    }

    return this.transactions.transaction(async () => {
      const moved = await this.userRepository.restoreTeams({
        slackTeamId: updatedBy.slack_team_id,
        restores,
        updatedBy: updatedBy.id,
      });

      this.tellTeamChanges(moved, updatedBy.id);

      return moved;
    });
  }

  // A Member who leads a team can't approve until they are a Manager. Only
  // Members change: anyone else already approves, or may not lead at all.
  public async makeManagers(
    userIds: string[],
    updatedBy: IUserViewModel,
  ): Promise<IUserViewModel[]> {
    if (userIds.length === 0) {
      return [];
    }

    return this.userRepository.updateMany(
      {
        slack_team_id: updatedBy.slack_team_id,
        id: { operator: 'in', value: userIds },
        role: UserRole.Member,
      },
      {
        role: UserRole.Manager,
        updated_at: new Date().toISOString(),
        updated_by: updatedBy.id,
      },
    );
  }

  // The reverse of makeManagers: a Manager gets `role` back, and anyone whose
  // role changed since stays as they are.
  public async restoreRoles(
    changes: { userId: string; role: UserRole }[],
    updatedBy: IUserViewModel,
  ): Promise<IUserViewModel[]> {
    const restored: IUserViewModel[] = [];

    for (const role of new Set(changes.map((change) => change.role))) {
      restored.push(
        ...(await this.userRepository.updateMany(
          {
            slack_team_id: updatedBy.slack_team_id,
            id: {
              operator: 'in',
              value: changes
                .filter((c) => c.role === role)
                .map((c) => c.userId),
            },
            role: UserRole.Manager,
          },
          {
            role,
            updated_at: new Date().toISOString(),
            updated_by: updatedBy.id,
          },
        )),
      );
    }

    return restored;
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

    const user = await this.userRepository.update(
      this.getFindQuery(findParams),
      {
        ...this.mapToDbUser(params),
        updated_at: new Date().toISOString(),
        updated_by: updatedBy?.id || null,
      },
    );

    if (user.team_id !== userBeforeUpdate.team_id) {
      this.tellTeamChanges([user], updatedBy?.id ?? null);
    }

    return user;
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

  public findInWorkspaceBySlackIds(
    workspaceSlackId: string,
    userSlackId: string,
  ) {
    return this.userRepository.findInWorkspaceBySlackIds(
      workspaceSlackId,
      userSlackId,
    );
  }

  // A Slack user ID is unique only within a workspace: on Enterprise Grid the
  // same person has the same ID in every workspace of the organization.
  public async findBySlackId(slackId: string, slackTeamId: string) {
    return await this.userRepository.findOne({
      slack_id: slackId,
      slack_team_id: slackTeamId,
    });
  }

  // Inside a transaction the listeners hear of it once it commits.
  private tellTeamChanges(users: IUserViewModel[], changedBy: string | null) {
    for (const user of users) {
      this.eventEmitter.emit(
        USER_TEAM_CHANGED,
        new UserTeamChangedEvent(
          user.id,
          user.slack_team_id,
          user.team_id,
          changedBy,
        ),
      );
    }
  }

  private getFindQuery(findParams: IFindParams): RepositoryFilter {
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
      // null takes the user out of their team.
      ...(params.teamId !== undefined ? { team_id: params.teamId } : {}),
      ...(params.role ? { role: params.role } : {}),
      // null clears the date.
      ...(params.contractStartDate !== undefined
        ? {
            contract_start_date:
              params.contractStartDate?.toISOString() ?? null,
          }
        : {}),
      ...(params.carryoverDays !== undefined
        ? { carryover_days: params.carryoverDays }
        : {}),
      ...(params.isActive !== undefined ? { is_active: params.isActive } : {}),
    };
  }
}
