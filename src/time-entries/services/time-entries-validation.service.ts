import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { isOpenTimeEntry } from 'src/time-entries/constants/open-time-entry-statuses';
import capitalize from '@common/utils/capitalize';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';
import { ValidationError } from '@common/errors/validation.error';

const MAX_MINUTES_PER_DAY = 24 * 60; // 1440

const PAST_TENSE = { edit: 'edited', delete: 'deleted' };
const MINUTES_STEP = 15;

@Injectable()
export class TimeEntriesValidationService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
  ) {}

  public async validateCreate(
    params: {
      userId: string;
      projectId: string;
      workDate: Date;
      minutes: number;
      status: TimeEntryStatus;
    },
    actor: IUserViewModel,
  ) {
    this.validateMinutes(params.minutes);
    this.validateCreatePermissions(params.userId, actor);
    this.validateStatusOnCreate(params.status, actor);

    await this.validateTotalDailyTime(
      params.userId,
      params.projectId,
      params.workDate,
      actor.slack_team_id,
      params.minutes,
    );
  }

  public async validateUpdate(
    existing: ITimeEntryViewModel,
    update: {
      userId?: string;
      projectId?: string;
      workDate?: Date;
      minutes?: number;
      status?: TimeEntryStatus;
    },
    actor: IUserViewModel,
  ) {
    this.validateEditPermissions(existing, actor);

    if (update.minutes !== undefined) {
      this.validateMinutes(update.minutes);
    }

    if (update.status !== undefined) {
      this.validateStatusTransition(existing.status, update.status, actor);
    }

    const targetUserId = update.userId ?? existing.user_id;
    const targetProjectId = update.projectId ?? existing.project_id;
    const targetWorkDate = update.workDate
      ? update.workDate
      : new Date(existing.work_date);

    if (
      update.userId ||
      update.projectId ||
      update.workDate ||
      update.minutes !== undefined
    ) {
      await this.validateTotalDailyTime(
        targetUserId,
        targetProjectId,
        targetWorkDate,
        actor.slack_team_id,
        update.minutes ?? existing.minutes,
        existing.id,
      );
    }
  }

  public validateDelete(existing: ITimeEntryViewModel, actor: IUserViewModel) {
    this.validateEditPermissions(existing, actor, 'delete');
  }

  private validateMinutes(minutes: number) {
    if (minutes <= 0) {
      throw new ValidationError('Logged minutes must be greater than 0');
    }

    if (minutes > MAX_MINUTES_PER_DAY) {
      throw new ValidationError(
        `Logged minutes cannot exceed ${MAX_MINUTES_PER_DAY}`,
      );
    }

    if (minutes % MINUTES_STEP !== 0) {
      throw new ValidationError(
        `Logged minutes must be in ${MINUTES_STEP} - minute increments`,
      );
    }
  }

  private validateCreatePermissions(
    targetUserId: string,
    actor: IUserViewModel,
  ) {
    if (targetUserId !== actor.id && !this.isAdmin(actor)) {
      throw new ForbiddenException('You cannot log time for another user');
    }
  }

  private validateEditPermissions(
    entry: ITimeEntryViewModel,
    actor: IUserViewModel,
    action: 'edit' | 'delete' = 'edit',
  ) {
    if (entry.user_id !== actor.id && !this.isAdmin(actor)) {
      throw new ForbiddenException(`You cannot ${action} this time entry`);
    }

    if (!isOpenTimeEntry(entry.status) && !this.isAdmin(actor)) {
      throw new ForbiddenException(
        `${capitalize(entry.status)} time entries cannot be ${PAST_TENSE[action]}`,
      );
    }
  }

  private validateStatusOnCreate(
    status: TimeEntryStatus,
    actor: IUserViewModel,
  ) {
    if (status === TimeEntryStatus.Approved && !this.isAdmin(actor)) {
      throw new ForbiddenException('Only admins can create approved entries');
    }
  }

  private validateStatusTransition(
    from: TimeEntryStatus,
    to: TimeEntryStatus,
    actor: IUserViewModel,
  ) {
    if (from === to) {
      return;
    }

    if (to === TimeEntryStatus.Approved && !this.isAdmin(actor)) {
      throw new ForbiddenException('Only admins can approve entries');
    }

    if (from === TimeEntryStatus.Approved && !this.isAdmin(actor)) {
      throw new ForbiddenException('Approved entries cannot be modified');
    }
  }

  private async validateTotalDailyTime(
    userId: string,
    projectId: string,
    workDate: Date,
    slackTeamId: string,
    newLogDurationMinutes: number,
    excludeId?: string,
  ) {
    const existingLogs = await this.timeEntriesRepository.findMany({
      user_id: userId,
      project_id: projectId,
      work_date: workDate.toISOString(),
      slack_team_id: slackTeamId,
      deleted_at: { operator: 'is', value: null },
    });

    const totalMinutes = existingLogs
      .filter((log) => log.id !== excludeId)
      .reduce((sum, log) => sum + (log.minutes || 0), 0);

    if (totalMinutes + newLogDurationMinutes > MAX_MINUTES_PER_DAY) {
      throw new ValidationError(
        'Total logged time for this project and date cannot exceed 24 hours',
      );
    }
  }

  private isAdmin(user: IUserViewModel): boolean {
    return isTimeEntriesAdmin(user.role);
  }
}
