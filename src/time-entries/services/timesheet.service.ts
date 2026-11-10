import { ForbiddenException, Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { shiftWeek, weekDays, weekStartOf } from '@common/utils/period-presets';
import { ValidationError } from '@common/errors/validation.error';
import { sumMinutes } from '@common/utils/time.utils';
import { TransactionService } from 'src/database/transaction.service';
import {
  GetUserProjectsQuery,
  IUserProject,
} from 'src/projects/queries/get-user-projects.query';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntriesValidationService } from 'src/time-entries/services/time-entries-validation.service';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { BILLED_ENTRY_MESSAGE } from 'src/time-entries/constants/billed-time-entries';
import { OPEN_TIME_ENTRY_STATUSES } from 'src/time-entries/constants/open-time-entry-statuses';
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  cellKey,
  ITimesheetCell,
  ITimesheetCellInput,
  ITimesheetOpenBefore,
  ITimesheetRow,
  ITimesheetSaveResult,
  ITimesheetWeek,
  MAX_TIMESHEET_ROWS,
  TimesheetCellLock,
} from 'src/time-entries/types/timesheet.types';
import { timesheetLock } from 'src/time-entries/utils/timesheet-lock';

// The week form offers the projects of the shown week and of the 4 before.
const RECENT_WEEKS = 4;

// The error at a cell that can't be changed in a form.
const LOCK_MESSAGES: Record<TimesheetCellLock, string> = {
  several:
    'This day has more than one entry on this project: change them on My time.',
  submitted: 'Submitted time entries cannot be edited',
  approved: 'Approved time entries cannot be edited',
  billed: BILLED_ENTRY_MESSAGE,
  project: 'This project is not available.',
};

// The day form's comment when no cell changed: there is no entry to put it on.
const COMMENT_WITHOUT_CHANGES_MESSAGE =
  'The comment goes on the entries whose hours you add or change: nothing changed.';

interface IProjectInfo {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  billable: boolean;
  archived: boolean;
}

// The workspace's projects as the forms and the week need them.
interface IProjectsOfUser {
  // Every project, archived ones too, by ID.
  projects: Map<string, IProjectInfo>;
  // The ones the user may log time on, in the order of get_user_projects.
  allowed: IUserProject[];
}

// The user's entries of a period that aren't deleted, cancelled ones
// included, and which of them are billed.
interface IEntriesOfUser {
  entries: ITimeEntryViewModel[];
  billedIds: Set<string>;
}

// What saving does to a cell: creates its entry, or changes or deletes the
// one it has.
interface ICellChange {
  key: string;
  input: ITimesheetCellInput;
  project: IProjectInfo;
  entry?: ITimeEntryViewModel;
}

const isNotCancelled = (entry: ITimeEntryViewModel) =>
  entry.status !== TimeEntryStatus.Cancelled;

// Projects without a client last.
const byClientAndName = (
  a: { clientName: string | null; name: string },
  b: { clientName: string | null; name: string },
) =>
  Number(!a.clientName) - Number(!b.clientName) ||
  (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
  a.name.localeCompare(b.name);

@Injectable()
export class TimesheetService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
    private readonly timeEntriesValidationService: TimeEntriesValidationService,
    private readonly transactions: TransactionService,
  ) {}

  // The week's table: a row for each project the user logged time on, however
  // many there are (only the forms have MAX_TIMESHEET_ROWS).
  public async getWeek(
    user: IUserViewModel,
    weekStart: string,
  ): Promise<ITimesheetWeek> {
    const days = weekDays(weekStart);
    const [week, projects] = await Promise.all([
      this.findEntries(user, days[0], days[6]),
      this.loadProjects(user),
    ]);
    const entries = week.entries.filter(isNotCancelled);

    return this.buildWeek(
      weekStart,
      entries,
      week.billedIds,
      new Map(entries.map((entry) => [entry.project_id, 0])),
      projects,
    );
  }

  // The week form's table, of the recent projects and the added ones, and
  // the projects the user may log on (to add).
  public async getForm(
    user: IUserViewModel,
    weekStart: string,
    addedProjectIds: string[],
  ): Promise<{ week: ITimesheetWeek; projects: IUserProject[] }> {
    const days = weekDays(weekStart);
    const recentFrom = shiftWeek(weekStart, -RECENT_WEEKS);
    const [found, projects] = await Promise.all([
      this.findEntries(user, recentFrom, days[6]),
      this.loadProjects(user),
    ]);
    const recent = found.entries.filter(isNotCancelled);
    const allowedIds = new Set(projects.allowed.map((project) => project.id));
    const weekEntries = recent.filter((entry) => entry.work_date >= days[0]);
    // Which rows stay when there are too many: the projects with time in the
    // shown week, so that the form shows all of it, then the added ones,
    // then the others. An older project the user may no longer log on
    // (archived, or no longer theirs) has nothing to show: no row.
    const ranks = new Map<string, number>();
    const rank = (projectId: string, value: number) => {
      if (!ranks.has(projectId)) {
        ranks.set(projectId, value);
      }
    };

    weekEntries.forEach((entry) => rank(entry.project_id, 0));
    addedProjectIds
      .filter((id) => allowedIds.has(id))
      .forEach((id) => rank(id, 1));
    recent
      .filter((entry) => allowedIds.has(entry.project_id))
      .forEach((entry) => rank(entry.project_id, 2));

    return {
      week: this.buildWeek(
        weekStart,
        weekEntries,
        found.billedIds,
        ranks,
        projects,
        MAX_TIMESHEET_ROWS,
      ),
      projects: projects.allowed,
    };
  }

  // The user's drafts and rejected entries dated before the week of
  // `weekStart`, which that week doesn't show: how many, and the Monday of the
  // oldest one's week. Null when there are none.
  public async findOpenBefore(
    user: IUserViewModel,
    weekStart: string,
  ): Promise<ITimesheetOpenBefore | null> {
    const entries = await this.timeEntriesService.findMany({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      statuses: OPEN_TIME_ENTRY_STATUSES,
      dateTo: weekDays(shiftWeek(weekStart, -1))[6],
    });

    if (!entries.length) {
      return null;
    }

    const [oldest] = entries.map((entry) => entry.work_date).sort();

    return { count: entries.length, weekStart: weekStartOf(oldest) };
  }

  // Saves what a form typed into the user's cells, all or nothing. A cell
  // still showing what the form showed is left alone, whatever it holds now:
  // a form opened before a change doesn't undo it. Every other cell is
  // checked against what it holds now (still what the form showed; one draft
  // or rejected entry of the user or none, on a project they may log on, at
  // most 24 hours) before anything is written; the first that fails throws
  // a ValidationError at it (its cellKey). A number creates a draft or
  // changes the cell's entry (a rejected one becomes a draft again), null
  // deletes the entry.
  // `comment` is the description of what is created or changed: with no
  // cell changed it would go nowhere, and saving refuses it at the field
  // `comment`. `submitWeekStart` submits that week's drafts and rejected
  // entries after saving.
  public async saveCells(
    user: IUserViewModel,
    inputs: ITimesheetCellInput[],
    {
      comment,
      submitWeekStart,
    }: { comment?: string; submitWeekStart?: string } = {},
  ): Promise<ITimesheetSaveResult> {
    const weekStart = inputs.length
      ? weekStartOf(inputs[0].date)
      : submitWeekStart;
    const otherWeek = inputs.find(
      (input) => weekStartOf(input.date) !== weekStart,
    );

    if (otherWeek) {
      throw new ValidationError(
        'A form saves one week at a time.',
        cellKey(otherWeek.projectId, otherWeek.date),
      );
    }

    const touched = inputs.filter(
      (input) => input.minutes !== input.shownMinutes,
    );

    if (comment && !touched.length) {
      throw new ValidationError(COMMENT_WITHOUT_CHANGES_MESSAGE, 'comment');
    }

    // The projects aren't the user's time, which the lock below guards: they
    // are read on the pool, while the transaction starts and takes the lock.
    // Started first, they get their connections before the transaction.
    const loadingProjects = touched.length ? this.loadProjects(user) : null;

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
        ? await this.findEntries(user, days[0], days[6])
        : { entries: [], billedIds: new Set<string>() };
      const projects = await loadingProjects;
      const changes = projects
        ? this.checkCells(user, touched, week, projects, comment)
        : [];
      await this.writeCells(user, changes, comment);

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
        ? this.weekMinutes(days, week.entries, changes)
        : { minutes: 0, minutesByDate: {} };
    });
  }

  // The projects the user may log time on, in the order of get_user_projects.
  // Admin and HR log time for anyone, so on any active project; everyone else
  // on the projects of their team and their own ones.
  public async allowedProjects(user: IUserViewModel): Promise<IUserProject[]> {
    if (!isTimeEntriesAdmin(user.role)) {
      return this.findUserProjects(user);
    }

    return this.activeProjects(
      await this.projectsService.findAllWithClientNames(user.slack_team_id),
    );
  }

  // Every project of the workspace and those the user may log on: one query
  // for Admin and HR, two at once for everyone else.
  private async loadProjects(user: IUserViewModel): Promise<IProjectsOfUser> {
    const [all, userProjects] = await Promise.all([
      this.projectsService.findAllWithClientNames(user.slack_team_id),
      isTimeEntriesAdmin(user.role) ? null : this.findUserProjects(user),
    ]);

    return {
      projects: new Map(
        all.map((project) => [
          project.id,
          {
            id: project.id,
            name: project.name,
            clientId: project.client_id,
            clientName: (project.client_id && project.client_name) || null,
            billable: project.billable,
            archived: !!project.archived_at,
          },
        ]),
      ),
      allowed: userProjects ?? this.activeProjects(all),
    };
  }

  private findUserProjects(user: IUserViewModel) {
    return this.getUserProjectsQuery.execute({
      userId: user.id,
      slackTeamId: user.slack_team_id,
    });
  }

  // The active ones of `projects`, in the order of get_user_projects: by
  // client, projects without one last.
  private activeProjects(
    projects: Awaited<ReturnType<ProjectsService['findAllWithClientNames']>>,
  ): IUserProject[] {
    return projects
      .filter((project) => !project.archived_at)
      .map((project) => ({
        id: project.id,
        name: project.name,
        clientId: project.client_id ?? '',
        clientName: (project.client_id && project.client_name) || '',
      }))
      .sort(byClientAndName);
  }

  // What each cell does, checked against what it holds now (`week`, read
  // under the lock), with the rules of TimeEntriesService.create, update and
  // delete. Throws at the first cell that can't take its input.
  private checkCells(
    user: IUserViewModel,
    inputs: ITimesheetCellInput[],
    week: IEntriesOfUser,
    { projects, allowed }: IProjectsOfUser,
    comment?: string,
  ): ICellChange[] {
    const allowedIds = new Set(allowed.map((project) => project.id));
    const entries = week.entries.filter(isNotCancelled);
    const changes: ICellChange[] = [];

    for (const input of inputs) {
      const key = cellKey(input.projectId, input.date);
      const project = projects.get(input.projectId);
      const onCell = (entry: ITimeEntryViewModel) =>
        entry.project_id === input.projectId && entry.work_date === input.date;
      const cellEntries = entries.filter(onCell);
      const cell = this.buildCell(
        input.date,
        cellEntries,
        !project || project.archived || !allowedIds.has(project.id),
        week.billedIds,
      );

      if (cell.lock) {
        throw new ValidationError(LOCK_MESSAGES[cell.lock], key);
      }

      // Time logged or changed elsewhere since the form opened: what was
      // typed would replace it unseen.
      if ((cell.minutes || null) !== input.shownMinutes) {
        throw new TimeEntryChangedError(key);
      }

      const [entry] = cellEntries;

      // Nothing there, and nothing typed.
      if (!entry && input.minutes === null) {
        continue;
      }

      // The user's other time on the cell's project and day, cancelled
      // entries too, for the 24 hours a day.
      const logged = sumMinutes(
        week.entries.filter((other) => onCell(other) && other.id !== entry?.id),
      );
      const validation = this.timeEntriesValidationService;

      this.atCell(key, () => {
        if (!entry) {
          validation.checkCreate(this.newEntry(user, input, comment), user);
          validation.checkDailyTotal(logged, input.minutes!);
        } else if (input.minutes === null) {
          validation.checkDelete(entry, user, week.billedIds.has(entry.id));
        } else {
          validation.checkUpdate(
            entry,
            { minutes: input.minutes, ...this.entryChanges(comment) },
            user,
            week.billedIds.has(entry.id),
          );
          validation.checkDailyTotal(logged, input.minutes);
        }
      });

      changes.push({ key, input, project: project!, entry });
    }

    return changes;
  }

  // Writes what checkCells found, through TimeEntriesService's writes: one
  // statement for the new entries, one for the changed ones and one for the
  // deleted ones. A change or deletion happens only while the entry is
  // still a draft or rejected, for every role: one submitted after the check
  // is refused, at the first such cell in the form's order (the transaction
  // undoes the rest).
  private async writeCells(
    user: IUserViewModel,
    changes: ICellChange[],
    comment?: string,
  ): Promise<void> {
    const created = changes.filter(({ entry }) => !entry);
    const updated = changes.filter(
      ({ entry, input }) => entry && input.minutes !== null,
    );
    const deleted = changes.filter(
      ({ entry, input }) => entry && input.minutes === null,
    );
    const openOnly = { openOnly: true };

    if (created.length) {
      await this.timeEntriesService.insertMany(
        created.map(({ input, project }) => ({
          params: this.newEntry(user, input, comment),
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
        ? await this.timeEntriesService.writeMinutes(
            new Map(
              updated.map(({ entry, input }) => [entry!.id, input.minutes!]),
            ),
            this.entryChanges(comment),
            user,
            openOnly,
          )
        : []),
      ...(deleted.length
        ? await this.timeEntriesService.writeDeletes(
            deleted.map(({ entry }) => entry!),
            user,
            openOnly,
          )
        : []),
    ]);
    const changed = changes.find(
      ({ entry }) => entry && leftAlone.has(entry.id),
    );

    if (changed) {
      throw new TimeEntryChangedError(changed.key);
    }
  }

  // The user's draft a cell creates.
  private newEntry(
    user: IUserViewModel,
    input: ITimesheetCellInput,
    comment?: string,
  ) {
    return {
      userId: user.id,
      teamId: user.team_id,
      projectId: input.projectId,
      workDate: new Date(`${input.date}T00:00:00Z`),
      minutes: input.minutes!,
      description: comment,
      status: TimeEntryStatus.Draft,
    };
  }

  // What a cell changes in its entry besides its minutes: a rejected one is
  // a draft again.
  private entryChanges(comment?: string) {
    return {
      status: TimeEntryStatus.Draft,
      ...(comment ? { description: comment } : {}),
    };
  }

  // Runs a check of the cell `key`: what it refuses is an error at that cell.
  private atCell(key: string, check: () => void) {
    try {
      check();
    } catch (error) {
      if (
        error instanceof ValidationError ||
        error instanceof ForbiddenException
      ) {
        throw new ValidationError(error.message, key);
      }

      throw error;
    }
  }

  // The user's time in the week of `days` after `changes`: what `entries`
  // (read before them) held, cancelled entries left out, in all and for each
  // day.
  private weekMinutes(
    days: string[],
    entries: ITimeEntryViewModel[],
    changes: ICellChange[],
  ) {
    const minutesByDate: Record<string, number> = Object.fromEntries(
      days.map((day) => [day, 0]),
    );

    for (const entry of entries.filter(isNotCancelled)) {
      minutesByDate[entry.work_date] += entry.minutes;
    }

    for (const { input, entry } of changes) {
      minutesByDate[input.date] += (input.minutes ?? 0) - (entry?.minutes ?? 0);
    }

    return {
      minutes: days.reduce((sum, day) => sum + minutesByDate[day], 0),
      minutesByDate,
    };
  }

  // The user's entries between two days and which are billed, in one query.
  // Cancelled ones are in: the 24 hours a day count them, the cells don't.
  private findEntries(
    user: IUserViewModel,
    dateFrom: string,
    dateTo: string,
  ): Promise<IEntriesOfUser> {
    return this.timeEntriesService.findOfUserWithBilled({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      dateFrom,
      dateTo,
    });
  }

  // `entries` are the week's; `ranks` the projects of the rows, the lower
  // the rank the sooner a project gets one of `maxRows` rows (all of them
  // without it).
  private buildWeek(
    weekStart: string,
    entries: ITimeEntryViewModel[],
    billedIds: Set<string>,
    ranks: Map<string, number>,
    { projects, allowed }: IProjectsOfUser,
    maxRows?: number,
  ): ITimesheetWeek {
    const days = weekDays(weekStart);
    const allowedIds = new Set(allowed.map((project) => project.id));

    const rows = [...ranks.keys()]
      .map((id) => projects.get(id))
      .filter((project): project is IProjectInfo => !!project)
      .sort(
        (a, b) => ranks.get(a.id)! - ranks.get(b.id)! || byClientAndName(a, b),
      )
      .slice(0, maxRows)
      .sort(byClientAndName)
      .map((project): ITimesheetRow => {
        const projectLocked = project.archived || !allowedIds.has(project.id);

        return {
          projectId: project.id,
          projectName: project.name,
          clientName: project.clientName,
          cells: days.map((date) =>
            this.buildCell(
              date,
              entries.filter(
                (entry) =>
                  entry.project_id === project.id && entry.work_date === date,
              ),
              projectLocked,
              billedIds,
            ),
          ),
        };
      });
    const shown = new Set(rows.map((row) => row.projectId));
    const shownEntries = entries.filter((entry) => shown.has(entry.project_id));
    const dayTotals = days.map((_, index) =>
      rows.reduce((sum, row) => sum + row.cells[index].minutes, 0),
    );
    const statusCounts = Object.fromEntries(
      Object.values(TimeEntryStatus).map((status) => [status, 0]),
    ) as Record<TimeEntryStatus, number>;

    for (const entry of shownEntries) {
      statusCounts[entry.status] += 1;
    }

    return {
      weekStart,
      days,
      rows,
      dayTotals,
      total: dayTotals.reduce((sum, minutes) => sum + minutes, 0),
      statusCounts,
    };
  }

  private buildCell(
    date: string,
    entries: ITimeEntryViewModel[],
    projectLocked: boolean,
    billedIds: Set<string>,
  ): ITimesheetCell {
    const minutes = sumMinutes(entries);
    const [only] = entries.length === 1 ? entries : [];
    let lock: TimesheetCellLock | null = null;

    if (projectLocked) {
      lock = 'project';
    } else if (entries.length > 1) {
      lock = 'several';
    } else if (only && billedIds.has(only.id)) {
      lock = 'billed';
    } else if (only?.status === TimeEntryStatus.Approved) {
      lock = 'approved';
    } else if (only?.status === TimeEntryStatus.Submitted) {
      lock = 'submitted';
    }

    return {
      date,
      minutes,
      entryCount: entries.length,
      lock,
    };
  }
}
