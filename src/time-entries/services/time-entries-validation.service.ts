import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import UserRole from '@common/enums/user-role.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { TimeEntryStatus } from '@modules/slack/tabs/time-tracking/enums/time-entry-status.enum';

const MAX_MINUTES_PER_DAY = 24 * 60; // 1440

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
    this.validateWorkDate(params.workDate, actor);
    this.validateCreatePermissions(params.userId, actor);
    this.validateStatusOnCreate(params.status, actor);

    await this.validateDuplicate(
      params.userId,
      params.projectId,
      params.workDate,
      actor.slack_team_id,
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

    if (update.workDate !== undefined) {
      this.validateWorkDate(update.workDate, actor);
    }

    if (update.status !== undefined) {
      this.validateStatusTransition(
        existing.status,
        update.status,
        actor,
      );
    }

    const targetUserId =
      update.userId ?? existing.user_id;
    const targetProjectId =
      update.projectId ?? existing.project_id;
    const targetWorkDate = update.workDate
      ? update.workDate
      : new Date(existing.work_date);

    if (
      update.userId ||
      update.projectId ||
      update.workDate
    ) {
      await this.validateDuplicate(
        targetUserId,
        targetProjectId,
        targetWorkDate,
        actor.slack_team_id,
        existing.id,
      );
    }
  }

  private validateMinutes(minutes: number) {
    if (minutes <= 0) {
      throw new BadRequestException(
        'Logged minutes must be greater than 0',
      );
    }

    if (minutes > MAX_MINUTES_PER_DAY) {
      throw new BadRequestException(
        `Logged minutes cannot exceed ${MAX_MINUTES_PER_DAY}`,
      );
    }
  }

  private validateWorkDate(
    date: Date,
    actor: IUserViewModel,
  ) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(date);
    target.setHours(0, 0, 0, 0);

    if (target > today && !this.isAdmin(actor)) {
      throw new BadRequestException(
        'You cannot log time for future dates',
      );
    }
  }

  private validateCreatePermissions(
    targetUserId: string,
    actor: IUserViewModel,
  ) {
    if (
      targetUserId !== actor.id &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(
        'You cannot log time for another user',
      );
    }
  }

  private validateEditPermissions(
    entry: ITimeEntryViewModel,
    actor: IUserViewModel,
  ) {
    if (
      entry.user_id !== actor.id &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(
        'You cannot edit this time entry',
      );
    }

    if (
      entry.status === TimeEntryStatus.Approved &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(
        'Approved time entries cannot be edited',
      );
    }
  }

  private validateStatusOnCreate(
    status: TimeEntryStatus,
    actor: IUserViewModel,
  ) {
    if (
      status === TimeEntryStatus.Approved &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(
        'Only admins can create approved entries',
      );
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

    if (
      to === TimeEntryStatus.Approved &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(
        'Only admins can approve entries',
      );
    }

    if (
      from === TimeEntryStatus.Approved &&
      !this.isAdmin(actor)
    ) {
      throw new ForbiddenException(
        'Approved entries cannot be modified',
      );
    }
  }

  private async validateDuplicate(
    userId: string,
    projectId: string,
    workDate: Date,
    slackTeamId: string,
    excludeId?: string,
  ) {
    const existing =
      await this.timeEntriesRepository.findOne({
        user_id: userId,
        project_id: projectId,
        work_date: workDate.toISOString(),
        slack_team_id: slackTeamId,
        deleted_at: null,
      });

    if (existing && existing.id !== excludeId) {
      throw new BadRequestException(
        'Time entry for this project and date already exists',
      );
    }
  }

  private isAdmin(user: IUserViewModel): boolean {
    return (
      user.role === UserRole.Admin ||
      user.role === UserRole.HR
    );
  }
}

