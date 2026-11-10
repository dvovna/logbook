import { ForbiddenException, Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ClientsService from '@modules/clients/services/clients.service';
import { weekDays, weekStartOf } from '@common/utils/period-presets';
import { ValidationError } from '@common/errors/validation.error';
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
import { TimeEntryChangedError } from 'src/time-entries/errors/time-entry-changed.error';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  cellKey,
  ITimesheetCell,
  ITimesheetCellInput,
  ITimesheetRow,
  ITimesheetSaveResult,
  ITimesheetWeek,
  MAX_TIMESHEET_ROWS,
  TimesheetCellLock,
} from 'src/time-entries/types/timesheet.types';

const DAY_MS = 24 * 60 * 60 * 1000;
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

interface IProjectInfo {
  id: string;
  name: string;
  clientId: string | null;
  clientName: string | null;
  billable: boolean;
  archived: boolean;
}

// What saving does to a cell: creates its entry, or changes or deletes the
// one it has.
interface ICellChange {
  key: string;
  input: ITimesheetCellInput;
  project: IProjectInfo;
  entry?: ITimeEntryViewModel;
}

const byClientAndName = (a: IProjectInfo, b: IProjectInfo) =>
  Number(!a.clientName) - Number(!b.clientName) ||
  (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
  a.name.localeCompare(b.name);

@Injectable()
export class TimesheetService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly clientsService: ClientsService,
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
    const entries = await this.findEntries(user, days[0], days[6]);

    return this.buildWeek(
      user,
      weekStart,
      entries,
      new Map(entries.map((entry) => [entry.project_id, 0])),
    );
  }

  // The week form's table: the recent projects and the added ones, which the
  // user may log on.
  public async getFormRows(
    user: IUserViewModel,
    weekStart: string,
    addedProjectIds: string[],
  ): Promise<ITimesheetWeek> {
    const days = weekDays(weekStart);
    const recentFrom = new Date(
      new Date(`${weekStart}T00:00:00Z`).getTime() - RECENT_WEEKS * 7 * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    const [recent, allowed] = await Promise.all([
      this.findEntries(user, recentFrom, days[6]),
      this.allowedProjects(user),
    ]);
    const allowedIds = new Set(allowed.map((project) => project.id));
    const weekEntries = recent.filter((entry) => entry.work_date >= days[0]);
    // Which rows stay when there are too many: the projects with time in the
    // shown week, so that the form shows all of it, then the added ones,
    // then the others.
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
    recent.forEach((entry) => rank(entry.project_id, 2));

    return this.buildWeek(user, weekStart, weekEntries, ranks, {
      allowed,
      maxRows: MAX_TIMESHEET_ROWS,
    });
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
  // `comment` is the description of what is created or changed;
  // `submitWeekStart` submits that week's drafts and rejected entries after
  // saving.
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

    return this.transactions.transaction(async () => {
      // Two saves of one person's time (a second click on Save) take turns,
      // and the second sees what the first wrote.
      await this.transactions.lock(`timesheet:${user.id}`);

      const changes = await this.checkCells(user, touched, comment);
      const result = await this.writeCells(user, changes, comment);

      if (submitWeekStart) {
        const days = weekDays(submitWeekStart);

        await this.timeEntriesService.submit(
          {
            slackTeamId: user.slack_team_id,
            dateFrom: days[0],
            dateTo: days[6],
          },
          user,
        );
      }

      return {
        ...result,
        ...(weekStart
          ? await this.weekMinutes(user, weekStart)
          : { minutes: 0, minutesByDate: {} }),
      };
    });
  }

  // The projects the user may log time on, in the order of get_user_projects.
  // Admin and HR log time for anyone, so on any active project; everyone else
  // on the projects of their team and their own ones.
  public async allowedProjects(user: IUserViewModel): Promise<IUserProject[]> {
    if (!isTimeEntriesAdmin(user.role)) {
      return this.getUserProjectsQuery.execute({
        userId: user.id,
        slackTeamId: user.slack_team_id,
      });
    }

    const [projects, clients] = await Promise.all([
      this.projectsService.findMany({ slackTeamId: user.slack_team_id }),
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
    ]);
    const clientNames = new Map(
      clients.map((client) => [client.id, client.name]),
    );

    // The order of get_user_projects: by client, projects without one last.
    return projects
      .map((project) => ({
        id: project.id,
        name: project.name,
        clientId: project.client_id ?? '',
        clientName:
          (project.client_id && clientNames.get(project.client_id)) || '',
      }))
      .sort(
        (a, b) =>
          Number(!a.clientName) - Number(!b.clientName) ||
          a.clientName.localeCompare(b.clientName) ||
          a.name.localeCompare(b.name),
      );
  }

  // What each cell does, checked against what it holds now, with the rules
  // of TimeEntriesService.create, update and delete. Throws at the first
  // cell that can't take its input.
  private async checkCells(
    user: IUserViewModel,
    inputs: ITimesheetCellInput[],
    comment?: string,
  ): Promise<ICellChange[]> {
    if (!inputs.length) {
      return [];
    }

    const dates = inputs.map((input) => input.date).sort();
    const [entries, projects, allowed] = await Promise.all([
      this.findEntries(user, dates[0], dates[dates.length - 1]),
      this.findProjects(user),
      this.allowedProjects(user),
    ]);
    const billedIds = await this.timeEntriesService.findBilledIds(
      user.slack_team_id,
      entries.map((entry) => entry.id),
    );
    const allowedIds = new Set(allowed.map((project) => project.id));
    const changes: ICellChange[] = [];

    for (const input of inputs) {
      const key = cellKey(input.projectId, input.date);
      const project = projects.get(input.projectId);
      const cellEntries = entries.filter(
        (entry) =>
          entry.project_id === input.projectId &&
          entry.work_date === input.date,
      );
      const cell = this.buildCell(
        input.date,
        cellEntries,
        !project || project.archived || !allowedIds.has(project.id),
        billedIds,
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

      await this.atCell(key, () => {
        if (!entry) {
          return this.timeEntriesValidationService.validateCreate(
            this.newEntry(user, input, comment),
            user,
          );
        }

        return input.minutes === null
          ? this.timeEntriesValidationService.validateDelete(entry, user)
          : this.timeEntriesValidationService.validateUpdate(
              entry,
              this.entryChanges(input.minutes, comment),
              user,
            );
      });

      changes.push({ key, input, project: project!, entry });
    }

    return changes;
  }

  // Writes what checkCells found, through TimeEntriesService's writes. A
  // change or deletion happens only while the entry is still a draft or
  // rejected, for every role: one submitted after the check is refused.
  private async writeCells(
    user: IUserViewModel,
    changes: ICellChange[],
    comment?: string,
  ): Promise<Omit<ITimesheetSaveResult, 'minutes' | 'minutesByDate'>> {
    const result = { created: 0, updated: 0, deleted: 0 };
    const openOnly = { openOnly: true };

    for (const { key, input, project, entry } of changes) {
      if (!entry) {
        await this.atCell(key, () =>
          this.timeEntriesService.insert(
            this.newEntry(user, input, comment),
            {
              id: project.id,
              client_id: project.clientId,
              billable: project.billable,
            },
            user,
          ),
        );
        result.created += 1;
      } else if (input.minutes === null) {
        await this.atCell(key, () =>
          this.timeEntriesService.writeDelete(entry, user, openOnly),
        );
        result.deleted += 1;
      } else {
        await this.atCell(key, () =>
          this.timeEntriesService.writeUpdate(
            entry,
            this.entryChanges(input.minutes!, comment),
            user,
            openOnly,
          ),
        );
        result.updated += 1;
      }
    }

    return result;
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

  // What a cell changes in its entry: a rejected one is a draft again.
  private entryChanges(minutes: number, comment?: string) {
    return {
      minutes,
      status: TimeEntryStatus.Draft,
      ...(comment ? { description: comment } : {}),
    };
  }

  // Runs a check or a write of the cell `key`: what it refuses is an error at
  // that cell.
  private async atCell<T>(key: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
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

  // The user's time in a week, in all and for each of its days.
  private async weekMinutes(user: IUserViewModel, weekStart: string) {
    const days = weekDays(weekStart);
    const entries = await this.findEntries(user, days[0], days[6]);
    const minutesByDate: Record<string, number> = Object.fromEntries(
      days.map((day) => [day, 0]),
    );

    for (const entry of entries) {
      minutesByDate[entry.work_date] += entry.minutes;
    }

    return {
      minutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
      minutesByDate,
    };
  }

  // The user's entries between two days, cancelled ones left out.
  private async findEntries(
    user: IUserViewModel,
    dateFrom: string,
    dateTo: string,
  ): Promise<ITimeEntryViewModel[]> {
    const entries = await this.timeEntriesService.findMany({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      dateFrom,
      dateTo,
    });

    return entries.filter(
      (entry) => entry.status !== TimeEntryStatus.Cancelled,
    );
  }

  // `entries` are the week's; `ranks` the projects of the rows, the lower
  // the rank the sooner a project gets one of `maxRows` rows (all of them
  // without it). `allowed` is passed when the caller has it.
  private async buildWeek(
    user: IUserViewModel,
    weekStart: string,
    entries: ITimeEntryViewModel[],
    ranks: Map<string, number>,
    { allowed, maxRows }: { allowed?: IUserProject[]; maxRows?: number } = {},
  ): Promise<ITimesheetWeek> {
    const days = weekDays(weekStart);
    const [projects, allowedProjects, billedIds] = await Promise.all([
      this.findProjects(user),
      allowed ?? this.allowedProjects(user),
      this.timeEntriesService.findBilledIds(
        user.slack_team_id,
        entries.map((entry) => entry.id),
      ),
    ]);
    const allowedIds = new Set(allowedProjects.map((project) => project.id));

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
    const minutes = entries.reduce((sum, entry) => sum + entry.minutes, 0);
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
      entryId: only?.id ?? null,
      entryCount: entries.length,
      lock,
    };
  }

  // Every project of the workspace, archived ones too, by ID.
  private async findProjects(
    user: IUserViewModel,
  ): Promise<Map<string, IProjectInfo>> {
    const [projects, clients] = await Promise.all([
      this.projectsService.findMany({
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
      this.clientsService.findMany({
        slackTeamId: user.slack_team_id,
        includeArchived: true,
      }),
    ]);
    const clientNames = new Map(
      clients.map((client) => [client.id, client.name]),
    );

    return new Map(
      projects.map((project) => [
        project.id,
        {
          id: project.id,
          name: project.name,
          clientId: project.client_id,
          clientName:
            (project.client_id && clientNames.get(project.client_id)) || null,
          billable: project.billable,
          archived: !!project.archived_at,
        },
      ]),
    );
  }
}
