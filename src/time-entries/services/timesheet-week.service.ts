import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { shiftWeek, weekDays, weekStartOf } from '@common/utils/period-presets';
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
  IEntriesOfUser,
  IProjectsOfUser,
  ITimesheetOpenBefore,
  ITimesheetProject,
  ITimesheetRow,
  ITimesheetWeek,
  ITimesheetWeekWithEntries,
} from 'src/time-entries/types/timesheet.types';
import {
  MAX_TIMESHEET_ROWS,
  TIMESHEET_RECENT_WEEKS,
} from 'src/time-entries/constants/timesheet';
import {
  buildCell,
  byClientAndName,
  isNotCancelled,
} from 'src/time-entries/utils/timesheet-cells';

@Injectable()
export class TimesheetWeekService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly getUserProjectsQuery: GetUserProjectsQuery,
  ) {}

  // The week's table: a row for each project the user logged time on, however
  // many there are (only the forms have MAX_TIMESHEET_ROWS).
  public async getWeek(
    user: IUserViewModel,
    weekStart: string,
  ): Promise<ITimesheetWeekWithEntries> {
    const days = weekDays(weekStart);
    const [found, projects] = await Promise.all([
      this.findEntries(user, days[0], days[6]),
      this.loadProjects(user),
    ]);
    const entries = found.entries.filter(isNotCancelled);

    return {
      week: this.buildWeek(
        weekStart,
        entries,
        found.billedIds,
        new Map(entries.map((entry) => [entry.project_id, 0])),
        projects,
      ),
      ...found,
    };
  }

  public async getForm(
    user: IUserViewModel,
    weekStart: string,
    addedProjectIds: string[],
  ): Promise<{ week: ITimesheetWeek; projects: IUserProject[] }> {
    const days = weekDays(weekStart);
    const recentFrom = shiftWeek(weekStart, -TIMESHEET_RECENT_WEEKS);
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
    const { count, oldest } = await this.timeEntriesService.countOpenUpTo({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      dateTo: weekDays(shiftWeek(weekStart, -1))[6],
    });

    return oldest ? { count, weekStart: weekStartOf(oldest) } : null;
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

  public async loadProjects(user: IUserViewModel): Promise<IProjectsOfUser> {
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

  // The user's entries between two days and which are billed, in one query.
  // Cancelled ones are in: the 24 hours a day count them, the cells don't.
  public findEntries(
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

  private findUserProjects(user: IUserViewModel) {
    return this.getUserProjectsQuery.execute({
      userId: user.id,
      slackTeamId: user.slack_team_id,
    });
  }

  // In the order of get_user_projects.
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
      .filter((project): project is ITimesheetProject => !!project)
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
            buildCell(
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
}
