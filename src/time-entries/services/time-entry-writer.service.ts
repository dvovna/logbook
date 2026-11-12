import { Injectable } from '@nestjs/common';
import { ValidationError } from '@common/errors/validation.error';
import { RepositoryFilter } from '@common/repositories/repository.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import {
  BILLED_ENTRY_MESSAGE,
  isBilledEntryError,
} from 'src/time-entries/constants/billed-time-entries';
import { OPEN_TIME_ENTRY_STATUSES } from 'src/time-entries/constants/open-time-entry-statuses';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  ITimeEntryActor,
  ITimeEntryCreateParams,
  ITimeEntryInsert,
  ITimeEntryProject,
  ITimeEntryUpdateParams,
  ITimeEntryUpdateWriteOptions,
  ITimeEntryWriteOptions,
} from 'src/time-entries/types/time-entry-writes.types';

// The writes of time entry rows, for entries the caller has checked. Status
// changes (submit, the approvals' decisions) update rows where they are
// decided.
@Injectable()
export class TimeEntryWriter {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
  ) {}

  public insert(
    params: ITimeEntryCreateParams,
    project: ITimeEntryProject,
    actor: ITimeEntryActor,
  ): Promise<ITimeEntryViewModel> {
    return this.timeEntriesRepository.create(
      this.newRow({ params, project }, actor),
    );
  }

  public insertMany(
    entries: ITimeEntryInsert[],
    actor: ITimeEntryActor,
  ): Promise<ITimeEntryViewModel[]> {
    return this.timeEntriesRepository.createMany(
      entries.map((entry) => this.newRow(entry, actor)),
    );
  }

  // The row of a new entry: its client and billability are its project's.
  private newRow(
    { params, project, vacationRequestId }: ITimeEntryInsert,
    actor: ITimeEntryActor,
  ) {
    const now = new Date().toISOString();

    return {
      user_id: params.userId,
      project_id: project.id,
      client_id: project.client_id,
      work_date: params.workDate.toISOString(),
      minutes: params.minutes,
      description: params.description || null,
      billable: project.billable,
      status: params.status,
      team_id: params.teamId,
      vacation_request_id: vacationRequestId ?? null,
      slack_team_id: actor.slack_team_id,
      created_at: now,
      updated_at: now,
      created_by: actor.id,
      updated_by: actor.id,
    };
  }

  // Writes `changes` to `entry` unless it changed since its check: deleted,
  // or no longer a draft or rejected when only such an entry may change
  // (`openOnly`, by default the owner's rule). Throws TimeEntryChangedError
  // then, and the billed message when a billing snapshot took the entry.
  public async writeUpdate(
    entry: ITimeEntryViewModel,
    changes: ITimeEntryUpdateParams,
    actor: IUserViewModel,
    {
      project,
      openOnly = !isTimeEntriesAdmin(actor.role),
    }: ITimeEntryUpdateWriteOptions = {},
  ): Promise<ITimeEntryViewModel> {
    const [updated] = await this.refusingBilled(() =>
      this.timeEntriesRepository.updateMany(
        this.unchangedSinceCheck(entry, openOnly),
        {
          ...this.changedColumns(changes, actor),
          ...(project
            ? {
                project_id: project.id,
                client_id: project.client_id,
                billable: project.billable,
              }
            : {}),
        },
      ),
    );

    if (!updated) {
      throw new TimeEntryChangedError();
    }

    return updated;
  }

  // Gives entries their new minutes (by ID), and all of them `changes`, in
  // one statement, as writeUpdate does one. Returns the IDs it left alone
  // because the entry changed since: the caller throws and its transaction
  // undoes the rest.
  public async writeMinutes(
    minutesById: Map<string, number>,
    changes: Pick<ITimeEntryUpdateParams, 'description' | 'status'>,
    actor: IUserViewModel,
    { openOnly = !isTimeEntriesAdmin(actor.role) }: ITimeEntryWriteOptions = {},
  ): Promise<string[]> {
    const written = new Set(
      await this.refusingBilled(() =>
        this.timeEntriesRepository.setMinutes(
          actor.slack_team_id,
          minutesById,
          this.changedColumns(changes, actor),
          openOnly ? OPEN_TIME_ENTRY_STATUSES : undefined,
        ),
      ),
    );

    return [...minutesById.keys()].filter((id) => !written.has(id));
  }

  private changedColumns(
    changes: ITimeEntryUpdateParams,
    actor: ITimeEntryActor,
  ) {
    return {
      ...(changes.userId !== undefined ? { user_id: changes.userId } : {}),
      ...(changes.teamId !== undefined ? { team_id: changes.teamId } : {}),
      ...(changes.workDate !== undefined
        ? { work_date: changes.workDate.toISOString() }
        : {}),
      ...(changes.minutes !== undefined ? { minutes: changes.minutes } : {}),
      ...(changes.description !== undefined
        ? { description: changes.description }
        : {}),
      ...(changes.status !== undefined ? { status: changes.status } : {}),
      // A changed entry is no longer the one that was rejected.
      ...(changes.status !== undefined &&
      changes.status !== TimeEntryStatus.Rejected
        ? { rejection_reason: null }
        : {}),
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    };
  }

  // Deletes `entry` (keeping it as history) unless it changed since its
  // check, as writeUpdate.
  public async writeDelete(
    entry: ITimeEntryViewModel,
    actor: IUserViewModel,
    options: ITimeEntryWriteOptions = {},
  ): Promise<void> {
    if ((await this.writeDeletes([entry], actor, options)).length) {
      throw new TimeEntryChangedError();
    }
  }

  // Deletes entries (keeping them as history) in one statement, as
  // writeDelete does one. Returns the IDs it left alone because the entry
  // changed since.
  public async writeDeletes(
    entries: ITimeEntryViewModel[],
    actor: IUserViewModel,
    { openOnly = !isTimeEntriesAdmin(actor.role) }: ITimeEntryWriteOptions = {},
  ): Promise<string[]> {
    if (!entries.length) {
      return [];
    }

    const ids = entries.map(({ id }) => id);
    const deleted = await this.refusingBilled(() =>
      this.timeEntriesRepository.updateMany(
        {
          id: { operator: 'in', value: ids },
          slack_team_id: actor.slack_team_id,
          deleted_at: { operator: 'is', value: null },
          ...(openOnly
            ? { status: { operator: 'in', value: OPEN_TIME_ENTRY_STATUSES } }
            : {}),
        },
        {
          deleted_at: new Date().toISOString(),
          deleted_by: actor.id,
        },
      ),
    );
    const written = new Set(deleted.map(({ id }) => id));

    return ids.filter((id) => !written.has(id));
  }

  // Deletes the entries linked to a vacation (keeping them as history) but
  // the billed ones, in one statement: what it deleted, and the days of the
  // billed ones.
  public deleteLinkedToVacation(
    requestId: string,
    slackTeamId: string,
    actorId: string,
  ) {
    return this.refusingBilled(() =>
      this.timeEntriesRepository.deleteVacationTime(
        slackTeamId,
        requestId,
        actorId,
      ),
    );
  }

  // The entry as the caller checked it: not deleted, and still a draft or
  // rejected when `openOnly`.
  private unchangedSinceCheck(
    entry: ITimeEntryViewModel,
    openOnly: boolean,
  ): RepositoryFilter {
    return {
      id: entry.id,
      slack_team_id: entry.slack_team_id,
      deleted_at: { operator: 'is', value: null },
      ...(openOnly
        ? { status: { operator: 'in', value: OPEN_TIME_ENTRY_STATUSES } }
        : {}),
    };
  }

  // A snapshot can take the entry between the check and the write; the
  // database then refuses the write (time_entries_keep_billed).
  private async refusingBilled<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (isBilledEntryError(error)) {
        throw new ValidationError(BILLED_ENTRY_MESSAGE);
      }

      throw error;
    }
  }
}
