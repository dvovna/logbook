import { ForbiddenException, Injectable } from '@nestjs/common';
import UserRole from '@common/enums/user-role.enum';
import { ValidationError } from '@common/errors/validation.error';
import { SupabaseFilter } from '@common/repositories/base.repository';
import { IUserViewModel } from '@modules/users/types/user.interface';
import TeamsService from '@modules/teams/services/teams.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntriesListQuery } from 'src/time-entries/queries/time-entries-list.query';
import { ITimeEntryListData } from 'src/time-entries/types/time-entries-list.types';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';

interface IApprovalScope {
  // The teams whose entries the user decides on; all teams when undefined.
  teamIds?: string[];
}

// Submitted time entries wait here for a decision. Admin and HR decide on
// everyone's, a manager on those of the teams that list them among their
// manager approvers (as for vacations). Nobody decides on their own entries.
@Injectable()
export class TimeEntryApprovalsService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly timeEntriesListQuery: TimeEntriesListQuery,
    private readonly teamsService: TeamsService,
  ) {}

  public async listPending(
    user: IUserViewModel,
    { page = 1, pageSize }: { page?: number; pageSize: number },
  ): Promise<ITimeEntryListData> {
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

  public async countPending(user: IUserViewModel): Promise<number> {
    const scope = await this.getScope(user);

    return scope
      ? this.timeEntriesRepository.count(this.getPendingFilter(user, scope))
      : 0;
  }

  // Approves the entry `id`, or every entry waiting for the user.
  public approve(user: IUserViewModel, id?: string) {
    return this.decide(user, TimeEntryStatus.Approved, id);
  }

  public async reject(
    user: IUserViewModel,
    id: string,
    reason?: string,
  ): Promise<ITimeEntryViewModel> {
    const [entry] = await this.decide(
      user,
      TimeEntryStatus.Rejected,
      id,
      reason,
    );

    return entry;
  }

  private async decide(
    user: IUserViewModel,
    status: TimeEntryStatus.Approved | TimeEntryStatus.Rejected,
    id?: string,
    reason?: string,
  ): Promise<ITimeEntryViewModel[]> {
    const scope = await this.getScope(user);

    if (!scope) {
      throw new ForbiddenException('You cannot approve time entries');
    }

    const decided = await this.timeEntriesRepository.updateMany(
      { ...this.getPendingFilter(user, scope), ...(id ? { id } : {}) },
      {
        status,
        // Kept for the owner, so they know what to fix.
        rejection_reason:
          status === TimeEntryStatus.Rejected ? reason?.trim() || null : null,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
    );

    if (id && !decided.length) {
      throw new ValidationError(
        'This time entry is no longer waiting for your approval.',
      );
    }

    return decided;
  }

  // null when the user approves nothing.
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
  ): SupabaseFilter {
    return {
      slack_team_id: user.slack_team_id,
      status: TimeEntryStatus.Submitted,
      deleted_at: { operator: 'is', value: null },
      user_id: { operator: 'neq', value: user.id },
      ...(teamIds ? { team_id: { operator: 'in', value: teamIds } } : {}),
    };
  }
}
