import { OPEN_TIME_ENTRY_STATUSES } from 'src/time-entries/constants/open-time-entry-statuses';
import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntriesScopeService } from 'src/time-entries/services/time-entries-scope.service';

export interface IUserTimeSummary {
  todayMinutes: number;
  // Today's time per client, most first; entries without one under null.
  todayByClient: { clientName: string | null; minutes: number }[];
  weekMinutes: number;
  // Drafts and rejected entries of any date, not sent for approval yet.
  unsubmitted: { count: number; minutes: number };
}

export interface IWorkspaceTimeSummary {
  weekMinutes: number;
  weekBillableMinutes: number;
  activeProjects: number;
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

// Monday to Sunday of the week of `date` (UTC, as work dates are).
const weekOf = (date: Date) => {
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return { dateFrom: isoDate(monday), dateTo: isoDate(sunday) };
};

const sumMinutes = (entries: { minutes: number }[]) =>
  entries.reduce((sum, { minutes }) => sum + minutes, 0);

// The numbers Home and Reports show, over all entries but
// deleted ones, whatever their status.
@Injectable()
export class TimeEntriesSummaryService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
    private readonly scopeService: TimeEntriesScopeService,
  ) {}

  public async getUserSummary(
    user: IUserViewModel,
    now = new Date(),
  ): Promise<IUserTimeSummary> {
    const today = isoDate(now);
    const [weekEntries, unsubmittedEntries] = await Promise.all([
      this.timeEntriesService.findMany({
        userId: user.id,
        slackTeamId: user.slack_team_id,
        ...weekOf(now),
      }),
      this.timeEntriesService.findMany({
        userId: user.id,
        slackTeamId: user.slack_team_id,
        statuses: OPEN_TIME_ENTRY_STATUSES,
      }),
    ]);
    const todayEntries = weekEntries.filter(
      ({ work_date }) => work_date === today,
    );

    const byClient = new Map<string | null, number>();
    for (const entry of todayEntries) {
      const clientName = entry.client?.name ?? null;
      byClient.set(clientName, (byClient.get(clientName) ?? 0) + entry.minutes);
    }

    return {
      todayMinutes: sumMinutes(todayEntries),
      todayByClient: [...byClient]
        .map(([clientName, minutes]) => ({ clientName, minutes }))
        .sort((a, b) => b.minutes - a.minutes),
      weekMinutes: sumMinutes(weekEntries),
      unsubmitted: {
        count: unsubmittedEntries.length,
        minutes: sumMinutes(unsubmittedEntries),
      },
    };
  }

  // This week's time `user` sees in reports (TimeEntriesScopeService): the
  // whole workspace for Admin and HR, a manager's teams and own time, else
  // their own.
  public async getWeekSummary(
    user: IUserViewModel,
    now = new Date(),
  ): Promise<IWorkspaceTimeSummary> {
    const [{ entries: weekEntries }, projects] = await Promise.all([
      this.scopeService.findEntries(user, weekOf(now)),
      this.projectsService.findMany({ slackTeamId: user.slack_team_id }),
    ]);

    return {
      weekMinutes: sumMinutes(weekEntries),
      weekBillableMinutes: sumMinutes(
        weekEntries.filter(({ billable }) => billable),
      ),
      activeProjects: projects.filter(
        ({ status }) => status === ProjectStatus.Active,
      ).length,
    };
  }
}
