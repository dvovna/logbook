import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';

export interface IUserTimeSummary {
  todayMinutes: number;
  // Today's time per client, most first; entries without one under null.
  todayByClient: { clientName: string | null; minutes: number }[];
  weekMinutes: number;
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

// The numbers the Home and Time & Billing tabs show, over all entries but
// deleted ones, whatever their status.
@Injectable()
export class TimeEntriesSummaryService {
  public constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly projectsService: ProjectsService,
  ) {}

  public async getUserSummary(
    user: IUserViewModel,
    now = new Date(),
  ): Promise<IUserTimeSummary> {
    const today = isoDate(now);
    const weekEntries = await this.timeEntriesService.findMany({
      userId: user.id,
      slackTeamId: user.slack_team_id,
      ...weekOf(now),
    });
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
    };
  }

  public async getWorkspaceSummary(
    slackTeamId: string,
    now = new Date(),
  ): Promise<IWorkspaceTimeSummary> {
    const [weekEntries, projects] = await Promise.all([
      this.timeEntriesService.findMany({ slackTeamId, ...weekOf(now) }),
      this.projectsService.findMany({ slackTeamId }),
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
