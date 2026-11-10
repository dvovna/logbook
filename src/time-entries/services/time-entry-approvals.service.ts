import { ForbiddenException, Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';
import { ValidationError } from '@common/errors/validation.error';
import { MAX_REJECTION_REASON_LENGTH } from '@common/constants/text-limits';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import TeamsService from '@modules/teams/services/teams.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import {
  ITimeEntryListData,
  ITimeEntryListItem,
} from 'src/time-entries/types/time-entries-list.types';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

interface IApprovalScope {
  // The teams whose entries the user decides on; all teams when undefined.
  teamIds?: string[];
}

interface IListPendingParams {
  page?: number;
  pageSize: number;
  // Admin and HR: every submitted entry, not only those waiting for them,
  // to decide for an approver who is away.
  all?: boolean;
}

// What deciding who approves an entry needs of it.
type IEntryKey = Pick<ITimeEntryViewModel, 'id' | 'team_id' | 'user_id'>;

// Submitted time entries wait for a decision, never by their owner.
// - A manager decides on the entries of the teams that list them among their
//   manager approvers (as for vacations): those wait for them.
// - Admin and HR may decide on anyone's, for an approver who is away, but
//   only these wait for them: their own teams' (as a manager approver), and
//   those nobody else decides (no team, or no other active approving manager
//   on it), which go to HR, or to the admins (fallbackApprovers, as time off
//   does).
@Injectable()
export class TimeEntryApprovalsService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly timeEntriesListQuery: TimeEntriesListQuery,
    private readonly teamsService: TeamsService,
    private readonly usersService: UsersService,
  ) {}

  public async listPending(
    user: IUserViewModel,
    { page = 1, pageSize, all = false }: IListPendingParams,
  ): Promise<ITimeEntryListData> {
    if (isTimeEntriesAdmin(user.role) && !all) {
      const waiting = await this.findWaitingForAdmin(user);
      const pageIds = waiting
        .slice((page - 1) * pageSize, page * pageSize)
        .map(({ id }) => id);
      const entries = pageIds.length
        ? await this.timeEntriesRepository.findMany({
            slack_team_id: user.slack_team_id,
            id: { operator: 'in', value: pageIds },
          })
        : [];
      const byId = new Map(entries.map((entry) => [entry.id, entry]));

      return {
        items: pageIds
          .map((id) => byId.get(id))
          .filter((entry): entry is ITimeEntryViewModel => !!entry)
          .map(toListItem),
        totalCount: waiting.length,
      };
    }

    const scope = await this.getScope(user);

    if (!scope) {
      return { items: [], totalCount: 0 };
    }

    return this.timeEntriesListQuery.execute({
      slackTeamId: user.slack_team_id,
      page,
      pageSize,
      status: TimeEntryStatus.Submitted,
      teamIds: scope.teamIds,
      excludeUserId: user.id,
    });
  }

  // How many entries wait for the user (not all those they may decide on).
  public async countPending(user: IUserViewModel): Promise<number> {
    if (isTimeEntriesAdmin(user.role)) {
      return (await this.findWaitingForAdmin(user)).length;
    }

    const scope = await this.getScope(user);

    return scope
      ? this.timeEntriesRepository.count(this.getPendingFilter(user, scope))
      : 0;
  }

  // Approves the entry `id`, or every entry waiting for the user.
  public async approve(user: IUserViewModel, id?: string) {
    if (id || !isTimeEntriesAdmin(user.role)) {
      return this.decide(user, TimeEntryStatus.Approved, id ? { id } : {});
    }

    const waiting = await this.findWaitingForAdmin(user);

    return this.decide(user, TimeEntryStatus.Approved, {
      id: { operator: 'in', value: waiting.map(({ id }) => id) },
    });
  }

  public async reject(
    user: IUserViewModel,
    id: string,
    reason?: string,
  ): Promise<ITimeEntryViewModel> {
    if (reason && reason.trim().length > MAX_REJECTION_REASON_LENGTH) {
      throw new ValidationError(
        `Reason must be at most ${MAX_REJECTION_REASON_LENGTH} characters`,
        'reason',
      );
    }

    const [entry] = await this.decide(
      user,
      TimeEntryStatus.Rejected,
      { id },
      reason,
    );

    return entry;
  }

  // Each entry's approvers, grouped by approver: who is told when entries
  // are submitted.
  public async groupByApprover(
    entries: ITimeEntryViewModel[],
    slackTeamId: string,
  ): Promise<{ approver: IUserViewModel; entries: ITimeEntryViewModel[] }[]> {
    const approversOf = await this.findApprovers(entries, slackTeamId);
    const groups = new Map<
      string,
      { approver: IUserViewModel; entries: ITimeEntryViewModel[] }
    >();

    for (const entry of entries) {
      for (const approver of approversOf.get(entry.id) ?? []) {
        const group = groups.get(approver.id) ?? { approver, entries: [] };

        group.entries.push(entry);
        groups.set(approver.id, group);
      }
    }

    return [...groups.values()];
  }

  // Decides the pending entries `filter` narrows to (one by its id, or
  // those waiting for the user) within what the user may decide.
  private async decide(
    user: IUserViewModel,
    status: TimeEntryStatus.Approved | TimeEntryStatus.Rejected,
    filter: RepositoryFilter,
    reason?: string,
  ): Promise<ITimeEntryViewModel[]> {
    const scope = await this.getScope(user);

    if (!scope) {
      throw new ForbiddenException('You cannot approve time entries');
    }

    const decided = await this.timeEntriesRepository.updateMany(
      { ...this.getPendingFilter(user, scope), ...filter },
      {
        status,
        // Kept for the owner, so they know what to fix.
        rejection_reason:
          status === TimeEntryStatus.Rejected ? reason?.trim() || null : null,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
    );

    if (filter.id && typeof filter.id === 'string' && !decided.length) {
      throw new ValidationError(
        'This time entry is no longer waiting for your approval.',
      );
    }

    return decided;
  }

  // The entries waiting for an admin or HR (see the class comment), newest
  // work first: their keys, no joins.
  private async findWaitingForAdmin(
    user: IUserViewModel,
  ): Promise<IEntryKey[]> {
    const submitted = await this.timeEntriesRepository.findSubmittedKeys(
      user.slack_team_id,
      user.id,
    );
    const approversOf = await this.findApprovers(submitted, user.slack_team_id);

    return submitted.filter((entry) =>
      approversOf.get(entry.id)?.some(({ id }) => id === user.id),
    );
  }

  // Who decides each entry, by entry ID: the active people with a role that
  // approves whom its team lists as manager approvers, other than the
  // owner; when there are none, fallbackApprovers. Everyone else with Admin
  // or HR may still decide it.
  private async findApprovers(
    entries: IEntryKey[],
    slackTeamId: string,
  ): Promise<Map<string, IUserViewModel[]>> {
    if (!entries.length) {
      return new Map();
    }

    const [teams, approving] = await Promise.all([
      this.teamsService.findMany({ slackTeamId }),
      this.usersService.findMany({ slackTeamId, roles: [...MANAGER_ROLES] }),
    ]);
    const approversByTeam = new Map(
      teams.map((team) => [team.id, team.manager_approvers ?? []]),
    );
    const bySlackId = new Map(
      approving.map((person) => [person.slack_id, person]),
    );

    return new Map(
      entries.map((entry) => {
        const managers = (
          (entry.team_id && approversByTeam.get(entry.team_id)) ||
          []
        )
          .map((slackId) => bySlackId.get(slackId))
          .filter(
            (person): person is IUserViewModel =>
              !!person && person.id !== entry.user_id,
          );

        return [
          entry.id,
          managers.length
            ? managers
            : (fallbackApprovers(approving, entry.user_id)?.approvers ?? []),
        ];
      }),
    );
  }

  // null when the user decides on nothing.
  private async getScope(user: IUserViewModel): Promise<IApprovalScope | null> {
    if (isTimeEntriesAdmin(user.role)) {
      return {};
    }

    if (user.role !== UserRole.Manager) {
      return null;
    }

    const teams = await this.teamsService.findMany({
      slackTeamId: user.slack_team_id,
      managerApprovers: [user.slack_id],
    });

    return { teamIds: teams.map(({ id }) => id) };
  }

  private getPendingFilter(
    user: IUserViewModel,
    { teamIds }: IApprovalScope,
  ): RepositoryFilter {
    return {
      slack_team_id: user.slack_team_id,
      status: TimeEntryStatus.Submitted,
      deleted_at: { operator: 'is', value: null },
      user_id: { operator: 'neq', value: user.id },
      ...(teamIds ? { team_id: { operator: 'in', value: teamIds } } : {}),
    };
  }
}

// An entry as the lists show it (get_time_entries_list's columns).
const toListItem = (entry: ITimeEntryViewModel): ITimeEntryListItem => ({
  id: entry.id,
  work_date: entry.work_date,
  created_at: entry.created_at,
  user_name: entry.user?.name ?? '',
  project_name: entry.project?.name ?? '',
  client_name: entry.client?.name ?? '',
  minutes: entry.minutes,
  description: entry.description ?? '',
  rejection_reason: entry.rejection_reason ?? null,
  user_id: entry.user_id,
  status: entry.status,
});
