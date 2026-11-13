import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UsersRepository } from '@modules/users/repositories/users.repository';
import { TransactionService } from 'src/database/transaction.service';
import { adminsLock } from 'src/database/advisory-locks';
import UserRole from '@common/enums/user-role.enum';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { ISearchParams, ISearchResult } from '@common/types/pagination.types';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { UserUpdateValidatorService } from '@modules/users/services/user-update-validator.service';
import {
  USER_ACCESS_CHANGED,
  USER_TEAM_CHANGED,
  UserAccessChangedEvent,
  UserTeamChangedEvent,
} from '@modules/users/events/users.events';
import { canApprove } from '@modules/users/utils/approver-roles';
import { publishApproversChanged } from '@modules/users/utils/approvers-changed';
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
  slackIds?: string[];
  isActive?: boolean;
  includeInactive?: boolean;
  email?: string;
  emails?: string[];
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
    return this.changingAccess(isActive === false, async () => {
      const user = await this.userRepository.upsert(
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

      // A deleted Slack account deactivates the user; telling of one that
      // was inactive already only makes the listener look again.
      if (isActive === false) {
        await this.tellAccessChanges([user as IUserViewModel]);
      }

      return user;
    });
  }

  // What Slack says about a person Logbook has: their profile and, for a
  // deleted account, that they are inactive. Never the role or the team,
  // which are Logbook's: a user read before this could carry ones that an
  // admin has changed since (an upsert would write them back), and no role
  // comes from Slack.
  public async refreshProfile({
    slackId,
    slackTeamId,
    email,
    name,
    isActive,
  }: {
    slackId: string;
    slackTeamId: string;
    email?: string;
    name: string;
    isActive?: boolean;
  }) {
    return this.changingAccess(isActive === false, async () => {
      const user = await this.userRepository.update(
        { slack_team_id: slackTeamId, slack_id: slackId },
        {
          email,
          name,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        },
      );

      if (isActive === false) {
        await this.tellAccessChanges([user]);
      }

      return user;
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

    return this.transactions.transaction(async () => {
      const promoted = await this.userRepository.updateMany(
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

      await this.tellApprovers(promoted);

      return promoted;
    });
  }

  // The reverse of makeManagers: a Manager gets `role` back, and anyone whose
  // role changed since stays as they are.
  public async restoreRoles(
    changes: { userId: string; role: UserRole }[],
    updatedBy: IUserViewModel,
  ): Promise<IUserViewModel[]> {
    return this.changingAccess(changes.length > 0, async () => {
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

      await this.tellAccessChanges(restored);

      return restored;
    });
  }

  // Sets the contract start of each user, in one statement (a leave
  // balances file). Nothing else changes, so nobody is told.
  public async setContractStartDates(
    changes: { userId: string; contractStartDate: Date }[],
    updatedBy: IUserViewModel,
  ): Promise<void> {
    if (!changes.length) {
      return;
    }

    await this.userRepository.setContractStartDates({
      slackTeamId: updatedBy.slack_team_id,
      dates: Object.fromEntries(
        changes.map(({ userId, contractStartDate }) => [
          userId,
          contractStartDate.toISOString(),
        ]),
      ),
      updatedBy: updatedBy.id,
    });
  }

  // The reverse of setContractStartDates: each contract start goes back only
  // while it still is `expected`. Returns the users that changed.
  public async restoreContractStartDates(
    changes: { userId: string; expected: string; before: string | null }[],
    updatedBy: IUserViewModel,
  ): Promise<string[]> {
    if (!changes.length) {
      return [];
    }

    return this.userRepository.restoreContractStartDates({
      slackTeamId: updatedBy.slack_team_id,
      changes,
      updatedBy: updatedBy.id,
    });
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

    return this.changingAccess(
      params.role !== undefined || params.isActive !== undefined,
      async () => {
        if (
          this.userUpdateValidatorService.takesAdminAway(
            userBeforeUpdate,
            params,
          )
        ) {
          await this.transactions.lock(
            adminsLock(userBeforeUpdate.slack_team_id),
          );
          await this.userUpdateValidatorService.assertAdminRemains(
            userBeforeUpdate.slack_team_id,
          );
        }

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

        if (
          user.role !== userBeforeUpdate.role ||
          user.is_active !== userBeforeUpdate.is_active
        ) {
          await this.tellAccessChanges([user]);
        }

        return user;
      },
    );
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

  // The listener saves the job that hands the approvals of someone who can
  // no longer approve over in the caller's transaction (emitAsync, see
  // changingAccess). Someone who can approve has none to hand over.
  private async tellAccessChanges(users: IUserViewModel[]) {
    for (const user of users.filter((user) => !canApprove(user))) {
      await this.eventEmitter.emitAsync(
        USER_ACCESS_CHANGED,
        new UserAccessChangedEvent(user.id, user.slack_team_id),
      );
    }

    await this.tellApprovers(users);
  }

  // The requests that waited for anyone who can approve them may go to
  // `users` now: the listener saves the job that starts them in the caller's
  // transaction.
  private async tellApprovers(users: IUserViewModel[]) {
    const approver = users.find(canApprove);

    if (approver) {
      await publishApproversChanged(this.eventEmitter, approver.slack_team_id);
    }
  }

  // A write that may change what people may do runs in a transaction with
  // the jobs that follow (tellAccessChanges); any other needs none.
  private changingAccess<T>(
    mayChange: boolean,
    write: () => Promise<T>,
  ): Promise<T> {
    return mayChange ? this.transactions.transaction(write) : write();
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
      ...(findParams.slackIds
        ? { slack_id: { operator: 'in', value: findParams.slackIds } }
        : {}),
      ...(findParams.isActive !== undefined
        ? { is_active: findParams.isActive }
        : { is_active: findParams.includeInactive ? undefined : true }),
      ...(findParams.email ? { email: findParams.email } : {}),
      ...(findParams.emails ? { email: findParams.emails } : {}),
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
