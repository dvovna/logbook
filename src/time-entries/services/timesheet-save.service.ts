import { ForbiddenException, Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { weekDays, weekStartOf } from '@common/utils/period-presets';
import { ValidationError } from '@common/errors/validation.error';
import { sumMinutes } from '@common/utils/time.utils';
import { TransactionService } from 'src/database/transaction.service';
import { timesheetLock } from 'src/database/advisory-locks';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryWriter } from 'src/time-entries/services/time-entry-writer.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { TimesheetWeekService } from 'src/time-entries/services/timesheet-week.service';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TimesheetCellError } from 'src/time-entries/errors/timesheet-cell.error';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  IEntriesOfUser,
  IProjectsOfUser,
  ITimesheetCellChange,
  ITimesheetCellRef,
  ITimesheetCellWrite,
  ITimesheetSaveResult,
} from 'src/time-entries/types/timesheet.types';
import {
  COMMENT_WITHOUT_CHANGES_MESSAGE,
  LOCKED_CELL_MESSAGE,
  OTHER_WEEK_MESSAGE,
} from 'src/time-entries/constants/timesheet';
import {
  buildCell,
  isNotCancelled,
} from 'src/time-entries/utils/timesheet-cells';

@Injectable()
export class TimesheetSaveService {
  public constructor(
    private readonly timesheetWeekService: TimesheetWeekService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly timeEntryWriter: TimeEntryWriter,
    private readonly timeEntriesValidationService: TimeEntriesValidationService,
    private readonly transactions: TransactionService,
  ) {}

  // Saves the user's cells, all or nothing. A cell still holding
  // `expectedMinutes` in its `minutes` is left alone, whatever it holds now:
  // a form opened before a change doesn't undo it. Every other cell is
  // checked against what it holds now (still `expectedMinutes`; one draft or
  // rejected entry of the user or none, on a project they may log on, at
  // most 24 hours) before anything is written; the first that fails throws a
  // TimesheetCellError about it. A number creates a draft or changes the
  // cell's entry (a rejected one becomes a draft again), null deletes the
  // entry.
  // `comment` is the description of what is created or changed: with no
  // cell changed it would go nowhere, and saving refuses it at the field
  // `comment`. `submitWeekStart` submits that week's drafts and rejected
  // entries after saving.
  public async saveCells(
    user: IUserViewModel,
    cells: ITimesheetCellChange[],
    {
      comment,
      submitWeekStart,
    }: { comment?: string; submitWeekStart?: string } = {},
  ): Promise<ITimesheetSaveResult> {
    const weekStart = cells.length
      ? weekStartOf(cells[0].date)
      : submitWeekStart;
    const otherWeek = cells.find(
      (cell) => weekStartOf(cell.date) !== weekStart,
    );

    if (otherWeek) {
      throw new TimesheetCellError(OTHER_WEEK_MESSAGE, otherWeek);
    }

    const touched = cells.filter(
      (cell) => cell.minutes !== cell.expectedMinutes,
    );

    if (comment && !touched.length) {
      throw new ValidationError(COMMENT_WITHOUT_CHANGES_MESSAGE, 'comment');
    }

    // The projects aren't the user's time, which the lock below guards: they
    // are read on the pool, while the transaction starts and takes the lock.
    // Started first, they get their connections before the transaction.
    const loadingProjects = touched.length
      ? this.timesheetWeekService.loadProjects(user)
      : null;

    // Awaited inside; this only keeps a failure before then from being an
    // unhandled rejection.
    loadingProjects?.catch(() => undefined);

    return this.transactions.transaction(async () => {
      // Two saves of one person's time (a second click on Save), or a save
      // and the logging of their time off, take turns, and the second sees
      // what the first wrote.
      await this.transactions.lock(timesheetLock(user.id));

      const days = weekStart ? weekDays(weekStart) : [];
      const week = weekStart
        ? await this.timesheetWeekService.findEntries(user, days[0], days[6])
        : { entries: [], billedIds: new Set<string>() };
      const projects = await loadingProjects;
      const writes = projects
        ? this.checkCells(user, touched, week, projects, comment)
        : [];
      await this.writeCells(user, writes, comment);

      if (submitWeekStart) {
        const submitDays = weekDays(submitWeekStart);

        await this.timeEntriesService.submit(
          {
            slackTeamId: user.slack_team_id,
            dateFrom: submitDays[0],
            dateTo: submitDays[6],
          },
          user,
        );
      }

      return weekStart
        ? this.weekMinutes(days, week.entries, writes)
        : { minutes: 0, minutesByDate: {} };
    });
  }

  // What each cell does, checked against what it holds now (`week`, read
  // under the lock), with the rules of TimeEntriesService.create, update and
  // delete. Throws at the first cell that can't take its minutes.
  private checkCells(
    user: IUserViewModel,
    cells: ITimesheetCellChange[],
    week: IEntriesOfUser,
    { projects, allowed }: IProjectsOfUser,
    comment?: string,
  ): ITimesheetCellWrite[] {
    const allowedIds = new Set(allowed.map((project) => project.id));
    const entries = week.entries.filter(isNotCancelled);
    const writes: ITimesheetCellWrite[] = [];

    for (const change of cells) {
      const project = projects.get(change.projectId);
      const onCell = (entry: ITimeEntryViewModel) =>
        entry.project_id === change.projectId &&
        entry.work_date === change.date;
      const cellEntries = entries.filter(onCell);
      const cell = buildCell(
        change.date,
        cellEntries,
        !project || project.archived || !allowedIds.has(project.id),
        week.billedIds,
      );

      if (cell.lock) {
        throw new TimesheetCellError(LOCKED_CELL_MESSAGE, change, cell.lock);
      }

      // Time logged or changed elsewhere since the form opened: what was
      // typed would replace it unseen.
      if ((cell.minutes || null) !== change.expectedMinutes) {
        throw new TimesheetCellError(TimeEntryChangedError.MESSAGE, change);
      }

      const [entry] = cellEntries;

      if (!entry && change.minutes === null) {
        continue;
      }

      // The user's other time on the cell's project and day, cancelled
      // entries too, for the 24 hours a day.
      const logged = sumMinutes(
        week.entries.filter((other) => onCell(other) && other.id !== entry?.id),
      );
      const validation = this.timeEntriesValidationService;

      this.atCell(change, () => {
        if (!entry) {
          validation.checkCreate(this.newEntry(user, change, comment), user);
          validation.checkDailyTotal(logged, change.minutes!);
        } else if (change.minutes === null) {
          validation.checkDelete(entry, user, week.billedIds.has(entry.id));
        } else {
          validation.checkUpdate(
            entry,
            { minutes: change.minutes, ...this.entryChanges(comment) },
            user,
            week.billedIds.has(entry.id),
          );
          validation.checkDailyTotal(logged, change.minutes);
        }
      });

      writes.push({ change, project: project!, entry });
    }

    return writes;
  }

  // Writes what checkCells found, through TimeEntryWriter: one statement for
  // the new entries, one for the changed ones and one for the deleted ones.
  // A change or deletion happens only while the entry is still a draft or
  // rejected, for every role: one submitted after the check is refused, at
  // the first such cell in the form's order (the transaction undoes the
  // rest).
  private async writeCells(
    user: IUserViewModel,
    writes: ITimesheetCellWrite[],
    comment?: string,
  ): Promise<void> {
    const created = writes.filter(({ entry }) => !entry);
    const updated = writes.filter(
      ({ entry, change }) => entry && change.minutes !== null,
    );
    const deleted = writes.filter(
      ({ entry, change }) => entry && change.minutes === null,
    );
    const openOnly = { openOnly: true };

    if (created.length) {
      await this.timeEntryWriter.insertMany(
        created.map(({ change, project }) => ({
          params: this.newEntry(user, change, comment),
          project: {
            id: project.id,
            client_id: project.clientId,
            billable: project.billable,
          },
        })),
        user,
      );
    }

    // The entries left alone because they changed since the check.
    const leftAlone = new Set([
      ...(updated.length
        ? await this.timeEntryWriter.writeMinutes(
            new Map(
              updated.map(({ entry, change }) => [entry!.id, change.minutes!]),
            ),
            this.entryChanges(comment),
            user,
            openOnly,
          )
        : []),
      ...(deleted.length
        ? await this.timeEntryWriter.writeDeletes(
            deleted.map(({ entry }) => entry!),
            user,
            openOnly,
          )
        : []),
    ]);
    const changed = writes.find(
      ({ entry }) => entry && leftAlone.has(entry.id),
    );

    if (changed) {
      throw new TimesheetCellError(
        TimeEntryChangedError.MESSAGE,
        changed.change,
      );
    }
  }

  private newEntry(
    user: IUserViewModel,
    change: ITimesheetCellChange,
    comment?: string,
  ) {
    return {
      userId: user.id,
      teamId: user.team_id,
      projectId: change.projectId,
      workDate: new Date(`${change.date}T00:00:00Z`),
      minutes: change.minutes!,
      description: comment,
      status: TimeEntryStatus.Draft,
    };
  }

  // A rejected entry is a draft again.
  private entryChanges(comment?: string) {
    return {
      status: TimeEntryStatus.Draft,
      ...(comment ? { description: comment } : {}),
    };
  }

  // What `check` refuses is an error about `cell`.
  private atCell(cell: ITimesheetCellRef, check: () => void) {
    try {
      check();
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof ForbiddenException
      ) {
        throw new TimesheetCellError(error.message, cell);
      }

      throw error;
    }
  }

  // The user's time in the week of `days` after `writes`: what `entries`
  // (read before them) held, cancelled entries left out, in all and for each
  // day.
  private weekMinutes(
    days: string[],
    entries: ITimeEntryViewModel[],
    writes: ITimesheetCellWrite[],
  ) {
    const minutesByDate: Record<string, number> = Object.fromEntries(
      days.map((day) => [day, 0]),
    );

    for (const entry of entries.filter(isNotCancelled)) {
      minutesByDate[entry.work_date] += entry.minutes;
    }

    for (const { change, entry } of writes) {
      minutesByDate[change.date] +=
        (change.minutes ?? 0) - (entry?.minutes ?? 0);
    }

    return {
      minutes: days.reduce((sum, day) => sum + minutesByDate[day], 0),
      minutesByDate,
    };
  }
}
