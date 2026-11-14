import { ForbiddenException, Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';
import { ValidationError } from '@common/errors/validation.error';
import { MAX_REJECTION_REASON_LENGTH } from '@common/constants/text-limits';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { ITimeEntryListData } from 'src/time-entries/types/time-entries-list.types';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { todayIso } from '@common/utils/period-presets';

export interface IMovedEntries {
  approver: IUserViewModel;
  groups: {
    teamName: string | null;
    away: { slackId: string; until: string }[];
    count: number;
  }[];
}

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

// Submitted time entries wait for a decision, never by their owner.
// - A manager decides on the entries of the teams that list them among their
//   manager approvers (as for vacations): those wait for them.
// - Admin and HR may decide on anyone's, for an approver who is away, but
//   only these wait for them: their own teams' (as a manager approver), and
//   those nobody else decides (no team, or no other active approving manager
//   on it), which go to HR, or to the admins (as fallbackApprovers does for
//   time off).
// - While every approver of an entry is on time off, it waits for HR at work
//   too (else the admins at work), and the away managers keep it; submitting
//   tells only those at work. When nobody who could decide is at work,
//   nothing changes.
// What waits for whom is one rule in SQL (TimeEntriesRepository.approves),
// for the count, the inbox, Approve all and the messages alike.
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
    if (all && isTimeEntriesAdmin(user.role)) {
      return this.timeEntriesListQuery.execute({
        slackTeamId: user.slack_team_id,
        page,
        pageSize,
        status: TimeEntryStatus.Submitted,
        teamIds: undefined,
        excludeUserId: user.id,
      });
    }

    if (!approvesTime(user)) {
      return { items: [], totalCount: 0 };
    }

    const today = todayIso();

    const [items, totalCount] = await Promise.all([
      this.timeEntriesRepository.findWaitingFor(
        user.slack_team_id,
        user.id,
        today,
        { limit: pageSize, offset: (page - 1) * pageSize },
      ),
      this.timeEntriesRepository.countWaitingFor(
        user.slack_team_id,
        user.id,
        today,
      ),
    ]);

    return { items, totalCount };
  }

  // How many entries wait for the user (not all those they may decide on).
  public async countPending(user: IUserViewModel): Promise<number> {
    return approvesTime(user)
      ? this.timeEntriesRepository.countWaitingFor(
          user.slack_team_id,
          user.id,
          todayIso(),
        )
      : 0;
  }

  // What has waited for the user since before `before` (see
  // TimeEntriesRepository.summarizeWaitingSince).
  public summarizeWaitingSince(user: IUserViewModel, before: Date) {
    return approvesTime(user)
      ? this.timeEntriesRepository.summarizeWaitingSince(
          user.slack_team_id,
          user.id,
          before,
          todayIso(),
        )
      : Promise.resolve({ count: 0, people: 0, oldest: null });
  }

  // The IDs of the people told of entries that have waited since before
  // `before`.
  public findApproversWaitingSince(slackTeamId: string, before: Date) {
    return this.timeEntriesRepository.findApproversWaitingSince(
      slackTeamId,
      before,
      todayIso(),
    );
  }

  // See TimeEntriesRepository.findStuckSince.
  public findStuckSince(slackTeamId: string, before: Date) {
    return this.timeEntriesRepository.findStuckSince(
      slackTeamId,
      before,
      todayIso(),
    );
  }

  // Approves the entry `id`, or every entry waiting for the user.
  public async approve(user: IUserViewModel, id?: string) {
    return this.decide(
      user,
      TimeEntryStatus.Approved,
      id ? { id } : this.waitingFilter(user),
    );
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

  // Each entry's approvers at work, grouped by approver: who is told when
  // entries are submitted.
  public async groupByApprover(
    entries: ITimeEntryViewModel[],
    slackTeamId: string,
  ): Promise<{ approver: IUserViewModel; entries: ITimeEntryViewModel[] }[]> {
    if (!entries.length) {
      return [];
    }

    // The approvers are among the active people with a role that approves.
    const [pairs, approving] = await Promise.all([
      this.timeEntriesRepository.findApproverIds(
        slackTeamId,
        entries.map(({ id }) => id),
        todayIso(),
      ),
      this.usersService.findMany({ slackTeamId, roles: [...MANAGER_ROLES] }),
    ]);
    const byId = new Map(approving.map((person) => [person.id, person]));
    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const groups = new Map<
      string,
      { approver: IUserViewModel; entries: ITimeEntryViewModel[] }
    >();

    for (const { entry_id, approver_id } of pairs) {
      const approver = byId.get(approver_id);
      const entry = entryById.get(entry_id);

      if (approver && entry) {
        const group = groups.get(approver.id) ?? { approver, entries: [] };

        group.entries.push(entry);
        groups.set(approver.id, group);
      }
    }

    return [...groups.values()];
  }

  // The submitted entries whose listed approvers are all on time off on
  // `date`, one of them from that day, by who is told of them instead (a
  // 'told' approver who is not a listed one), then by team: what the daily
  // check tells HR the day a manager's time off begins. Reads no entries on
  // a day when no approving person's time off begins, and works by team and
  // owner, not by entry.
  public async findMovedByAbsence(
    slackTeamId: string,
    date: string,
  ): Promise<IMovedEntries[]> {
    const [away, approving] = await Promise.all([
      this.usersService.findAway(slackTeamId, date),
      this.usersService.findMany({ slackTeamId, roles: [...MANAGER_ROLES] }),
    ]);
    const byId = new Map(approving.map((person) => [person.id, person]));

    if (
      ![...away.values()].some(
        ({ userId, since }) => since === date && byId.has(userId),
      )
    ) {
      return [];
    }

    const [listedRows, toldRows, teams] = await Promise.all([
      this.timeEntriesRepository.findSubmittedGroupApprovers(
        slackTeamId,
        date,
        'listed',
      ),
      this.timeEntriesRepository.findSubmittedGroupApprovers(
        slackTeamId,
        date,
        'told',
      ),
      this.teamsService.findMany({ slackTeamId }),
    ]);
    const awayById = new Map(
      [...away].map(([slackId, absence]) => [
        absence.userId,
        { slackId, ...absence },
      ]),
    );
    const groupKey = (row: { team_id: string | null; user_id: string }) =>
      `${row.team_id ?? ''}:${row.user_id}`;
    const listedOf = new Map<string, string[]>();
    const toldOf = new Map<
      string,
      { teamId: string | null; entries: number; approverIds: string[] }
    >();

    for (const row of listedRows) {
      const key = groupKey(row);

      listedOf.set(key, [...(listedOf.get(key) ?? []), row.approver_id]);
    }
    for (const row of toldRows) {
      const key = groupKey(row);
      const group = toldOf.get(key) ?? {
        teamId: row.team_id,
        entries: row.entries,
        approverIds: [],
      };

      group.approverIds.push(row.approver_id);
      toldOf.set(key, group);
    }

    const teamName = new Map(teams.map(({ id, name }) => [id, name]));
    const result = new Map<
      string,
      {
        approver: IUserViewModel;
        groups: Map<
          string,
          {
            teamName: string | null;
            away: Map<string, { slackId: string; until: string }>;
            count: number;
          }
        >;
      }
    >();

    for (const [key, { teamId, entries, approverIds }] of toldOf) {
      const listed = listedOf.get(key) ?? [];
      const absences = listed.map((id) => awayById.get(id));

      if (
        !listed.length ||
        absences.some((absence) => !absence) ||
        !absences.some((absence) => absence?.since === date)
      ) {
        continue;
      }

      for (const approverId of approverIds) {
        const approver = byId.get(approverId);

        if (!approver || listed.includes(approverId)) {
          continue;
        }

        const person = result.get(approverId) ?? {
          approver,
          groups: new Map(),
        };
        const teamKey = teamId ?? '';
        const group = person.groups.get(teamKey) ?? {
          teamName: teamId ? (teamName.get(teamId) ?? null) : null,
          away: new Map(),
          count: 0,
        };

        for (const absence of absences) {
          group.away.set(absence!.userId, {
            slackId: absence!.slackId,
            until: absence!.until,
          });
        }
        group.count += entries;
        person.groups.set(teamKey, group);
        result.set(approverId, person);
      }
    }

    return [...result.values()].map(({ approver, groups }) => ({
      approver,
      groups: [...groups.values()].map(({ away: awayPeople, ...group }) => ({
        ...group,
        away: [...awayPeople.values()],
      })),
    }));
  }

  // Decides the pending entries `narrowing` names (one by its id, or those
  // waiting for the user) within what the user may decide.
  private async decide(
    user: IUserViewModel,
    status: TimeEntryStatus.Approved | TimeEntryStatus.Rejected,
    narrowing: RepositoryFilter | Promise<RepositoryFilter>,
    reason?: string,
  ): Promise<ITimeEntryViewModel[]> {
    const [scope, filter] = await Promise.all([this.getScope(user), narrowing]);

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

  // The entries waiting for the user, by their IDs.
  private async waitingFilter(user: IUserViewModel): Promise<RepositoryFilter> {
    return {
      id: {
        operator: 'in',
        value: approvesTime(user)
          ? await this.timeEntriesRepository.findWaitingIds(
              user.slack_team_id,
              user.id,
              todayIso(),
            )
          : [],
      },
    };
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

// Only these roles decide on time entries; nothing waits for anyone else.
const approvesTime = (user: IUserViewModel) =>
  MANAGER_ROLES.includes(user.role);
