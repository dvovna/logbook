import { Injectable } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { ProjectStatus } from 'src/projects/enums/project-status.enum';
import { TimeEntriesRepository } from 'src/time-entries/repositories/time-entries.repository';
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

// The numbers Home and Reports show, over all entries but
// deleted ones, whatever their status, counted and summed in the database.
@Injectable()
export class TimeEntriesSummaryService {
  public constructor(
    private readonly timeEntriesRepository: TimeEntriesRepository,
    private readonly projectsService: ProjectsService,
    private readonly scopeService: TimeEntriesScopeService,
  ) {}

  public async getUserSummary(
    user: IUserViewModel,
    now = new Date(),
  ): Promise<IUserTimeSummary> {
    const [week, today] = await Promise.all([
      this.timeEntriesRepository.sumOfUser(
        user.slack_team_id,
        user.id,
        weekOf(now),
      ),
      this.timeEntriesRepository.sumOfUserByClient(
        user.slack_team_id,
        user.id,
        isoDate(now),
      ),
    ]);

    return {
      todayMinutes: today.reduce((total, { minutes }) => total + minutes, 0),
      todayByClient: today.map(({ client_name, minutes }) => ({
        clientName: client_name,
        minutes,
      })),
      weekMinutes: week.minutes,
      unsubmitted: { count: week.openCount, minutes: week.openMinutes },
    };
  }

  // This week's time `user` sees in reports (TimeEntriesScopeService): the
  // whole workspace for Admin, HR and Finance, a manager's teams and own time, else
  // their own.
  public async getWeekSummary(
    user: IUserViewModel,
    now = new Date(),
  ): Promise<IWorkspaceTimeSummary> {
    const [week, activeProjects] = await Promise.all([
      this.scopeService.sumMinutes(user, weekOf(now)),
      this.projectsService.count({
        slackTeamId: user.slack_team_id,
        status: ProjectStatus.Active,
      }),
    ]);

    return {
      weekMinutes: week.minutes,
      weekBillableMinutes: week.billableMinutes,
      activeProjects,
    };
  }
}
