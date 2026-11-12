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
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ValidationError } from '@common/errors/validation.error';
import { MAX_TIME_ENTRY_DESCRIPTION_LENGTH } from '@common/constants/text-limits';
import { BILLED_ENTRY_MESSAGE } from 'src/time-entries/constants/billed-time-entries';

const MAX_MINUTES_PER_DAY = 24 * 60; // 1440

const PAST_TENSE = { edit: 'edited', delete: 'deleted' };
const MINUTES_STEP = 15;

interface ICreateCheckParams {
  userId: string;
  projectId: string;
  workDate: Date;
  minutes: number;
  status: TimeEntryStatus;
  description?: string | null;
}

interface IUpdateCheckParams {
  userId?: string;
  projectId?: string;
  workDate?: Date;
  minutes?: number;
  status?: TimeEntryStatus;
  description?: string | null;
}

@Injectable()
export class TimeEntriesValidationService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
  ) {}

  public async validateCreate(
    params: ICreateCheckParams,
    actor: IUserViewModel,
  ) {
    this.checkCreate(params, actor);

    this.checkDailyTotal(
      await this.loggedMinutes(
        params.userId,
        params.projectId,
        params.workDate,
        actor.slack_team_id,
      ),
      params.minutes,
    );
  }

  public async validateUpdate(
    existing: ITimeEntryViewModel,
    update: IUpdateCheckParams,
    actor: IUserViewModel,
  ) {
    // Someone who may not edit the entry is refused before anything is read.
    this.validateEditPermissions(existing, actor);

    const changesDay =
      update.userId ||
      update.projectId ||
      update.workDate ||
      update.minutes !== undefined;

    const [billed, loggedMinutes] = await Promise.all([
      this.isBilled(existing),
      changesDay
        ? this.loggedMinutes(
            update.userId ?? existing.user_id,
            update.projectId ?? existing.project_id,
            update.workDate ?? new Date(existing.work_date),
            actor.slack_team_id,
            existing.id,
          )
        : undefined,
    ]);

    this.checkUpdate(existing, update, actor, billed);

    if (loggedMinutes !== undefined) {
      this.checkDailyTotal(loggedMinutes, update.minutes ?? existing.minutes);
    }
  }

  public async validateDelete(
    existing: ITimeEntryViewModel,
    actor: IUserViewModel,
  ) {
    this.validateEditPermissions(existing, actor, 'delete');
    this.checkDelete(existing, actor, await this.isBilled(existing));
  }

  // The rules. The validate* methods above read what they need (whether the
  // entry is billed, the time on its project and day) and call these; the week
  // form reads that for many entries at once and calls them itself.

  public checkCreate(params: ICreateCheckParams, actor: IUserViewModel) {
    this.validateMinutes(params.minutes);
    this.validateDescription(params.description);
    this.validateCreatePermissions(params.userId, actor);
    this.validateStatusOnCreate(params.status, actor);
  }

  public checkUpdate(
    existing: ITimeEntryViewModel,
    update: IUpdateCheckParams,
    actor: IUserViewModel,
    billed: boolean,
  ) {
    this.validateEditPermissions(existing, actor);
    this.refuseBilled(billed);
    this.checkUpdateValues(existing, update, actor);
  }

  public checkDelete(
    existing: ITimeEntryViewModel,
    actor: IUserViewModel,
    billed: boolean,
  ) {
    this.validateEditPermissions(existing, actor, 'delete');
    this.refuseBilled(billed);
  }

  // `loggedMinutes`: the time the user has on the entry's project and day
  // without the entry itself, deleted entries left out.
  public checkDailyTotal(loggedMinutes: number, minutes: number) {
    if (loggedMinutes + minutes > MAX_MINUTES_PER_DAY) {
      throw new ValidationError(
        'Total logged time for this project and date cannot exceed 24 hours',
        'minutes',
      );
    }
  }

  private checkUpdateValues(
    existing: ITimeEntryViewModel,
    update: IUpdateCheckParams,
    actor: IUserViewModel,
  ) {
    this.validateDescription(update.description);

    if (update.minutes !== undefined) {
      this.validateMinutes(update.minutes);
    }

    if (update.status !== undefined) {
      this.validateStatusTransition(existing.status, update.status, actor);
    }
  }

  private async isBilled(entry: ITimeEntryViewModel) {
    const billed = await this.timeEntriesRepository.findBilledIds(
      entry.slack_team_id,
      [entry.id],
    );

    return billed.has(entry.id);
  }

  // Whoever asks, Admin included: an admin unlocks the snapshot first.
  private refuseBilled(billed: boolean) {
    if (billed) {
      throw new ValidationError(BILLED_ENTRY_MESSAGE);
    }
  }

  private validateMinutes(minutes: number) {
    if (minutes <= 0) {
      throw new ValidationError(
        'Logged minutes must be greater than 0',
        'minutes',
      );
    }

    if (minutes > MAX_MINUTES_PER_DAY) {
      throw new ValidationError(
        `Logged minutes cannot exceed ${MAX_MINUTES_PER_DAY}`,
        'minutes',
      );
    }

    if (minutes % MINUTES_STEP !== 0) {
      throw new ValidationError(
        `Logged minutes must be in ${MINUTES_STEP} - minute increments`,
        'minutes',
      );
    }
  }

  private validateDescription(description: string | null | undefined) {
    if (description && description.length > MAX_TIME_ENTRY_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `Description must be at most ${MAX_TIME_ENTRY_DESCRIPTION_LENGTH} characters`,
        'description',
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

    // The owner logs a draft or submits it; the other statuses are decisions.
    if (
      status !== TimeEntryStatus.Draft &&
      status !== TimeEntryStatus.Submitted &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(`Only admins can create ${status} entries`);
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

  private async loggedMinutes(
    userId: string,
    projectId: string,
    workDate: Date,
    slackTeamId: string,
    excludeId?: string,
  ) {
    const existingLogs = await this.timeEntriesRepository.findMany({
      user_id: userId,
      project_id: projectId,
      work_date: workDate.toISOString(),
      slack_team_id: slackTeamId,
      deleted_at: { operator: 'is', value: null },
    });

    return existingLogs
      .filter((log) => log.id !== excludeId)
      .reduce((sum, log) => sum + (log.minutes || 0), 0);
  }

  private isAdmin(user: IUserViewModel): boolean {
    return isTimeEntriesAdmin(user.role);
  }
}
