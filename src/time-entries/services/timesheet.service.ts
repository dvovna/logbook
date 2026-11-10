import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ClientsService from '@modules/clients/services/clients.service';
import { weekDays } from '@common/utils/period-presets';
import {
  GetUserProjectsQuery,
  IUserProject,
} from 'src/projects/queries/get-user-projects.query';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { isTimeEntriesAdmin } from 'src/time-entries/constants/time-entries-admin-roles';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import {
  ITimesheetCell,
  ITimesheetRow,
  ITimesheetWeek,
  MAX_TIMESHEET_ROWS,
  TimesheetCellLock,
} from 'src/time-entries/types/timesheet.types';

const DAY_MS = 24 * 60 * 60 * 1000;
// The week form offers the projects of the shown week and of the 4 before.
const RECENT_WEEKS = 4;

interface IProjectInfo {
  id: string;
  name: string;
  clientName: string | null;
  archived: boolean;
}

@Injectable()
export class TimesheetService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly clientsService: ClientsService,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
  ) {}

  // The week's table: a row for each project the user logged time on.
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
      new Set(entries.map((entry) => entry.project_id)),
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
    const projectIds = new Set([
      ...recent.map((entry) => entry.project_id),
      ...addedProjectIds.filter((id) => allowedIds.has(id)),
    ]);

    return this.buildWeek(
      user,
      weekStart,
      recent.filter((entry) => entry.work_date >= days[0]),
      projectIds,
      allowed,
    );
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

  // `entries` are the week's. `allowed` is passed when the caller has it.
  private async buildWeek(
    user: IUserViewModel,
    weekStart: string,
    entries: ITimeEntryViewModel[],
    projectIds: Set<string>,
    allowed?: IUserProject[],
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

    const rows = [...projectIds]
      .map((id) => projects.get(id))
      .filter((project): project is IProjectInfo => !!project)
      .sort(
        (a, b) =>
          Number(!a.clientName) - Number(!b.clientName) ||
          (a.clientName ?? '').localeCompare(b.clientName ?? '') ||
          a.name.localeCompare(b.name),
      )
      .slice(0, MAX_TIMESHEET_ROWS)
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

    return { date, minutes, entryId: only?.id ?? null, lock };
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
          clientName:
            (project.client_id && clientNames.get(project.client_id)) || null,
          archived: !!project.archived_at,
        },
      ]),
    );
  }
}
