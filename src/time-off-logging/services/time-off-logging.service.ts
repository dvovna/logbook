import { ForbiddenException, Injectable } from '@nestjs/common';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import { sumMinutes } from '@common/utils/time.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import {
  timesheetLock,
  vacationRequestLock,
} from 'src/database/advisory-locks';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TransactionService } from 'src/database/transaction.service';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';
import { VacationTimeService } from 'src/time-off-logging/services/vacation-time.service';
import {
  ITimeOffOffer,
  ITimeOffPlan,
  ITimeOffResult,
} from 'src/time-off-logging/types/time-off-offer.types';
import {
  isTimeOffLeaveType,
  TIME_OFF_DESCRIPTIONS,
  TimeOffLeaveType,
} from 'src/time-off-logging/constants/time-off-leave-types';

// Approved time off made in Logbook: imported leave gets no time.
const loggable = (request: IVacationRequestViewModel) =>
  request.status === VacationRequestStatus.Approved &&
  !request.leave_file_upload_id;

@Injectable()
export class TimeOffLoggingService {
  public constructor(
    private readonly settingsService: TimeOffSettingsService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
    private readonly teamRulesService: TeamRulesService,
    private readonly daysCalculationService: VacationDaysCalculationService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly vacationTimeService: VacationTimeService,
    private readonly transactions: TransactionService,
  ) {}

  // Null unless the time off is approved and not imported from a leave file,
  // its type has an active project, its requester is active and it has
  // working days left.
  public async offerFor(
    request: IVacationRequestViewModel,
  ): Promise<ITimeOffOffer | null> {
    return (await this.plan(request))?.offer ?? null;
  }

  // What a click needs before it is worth acting on: the requester's own,
  // approved time off. `log` checks it again under its lock.
  public async assertCanLog(user: IUserViewModel, requestId: string) {
    const request = await this.vacationRequestsService.findOneWithValidation({
      id: requestId,
      slackTeamId: user.slack_team_id,
    });

    this.assertLoggable(request, user);
  }

  // The requester's own time off only. A day that has any time of theirs on
  // the project is skipped, so a second run, or a second click at the same
  // moment, writes nothing more; so is a day that has time of this request
  // on another project, so a changed type never logs a day twice.
  // It takes the request's lock and the one on the user's time that a
  // timesheet save takes, so a save of the same days waits for it.
  public async log(
    user: IUserViewModel,
    requestId: string,
  ): Promise<ITimeOffResult> {
    const slackTeamId = user.slack_team_id;

    return this.transactions.transaction(async () => {
      await this.transactions.lockInOrder(
        vacationRequestLock(requestId),
        timesheetLock(user.id),
      );

      const request = await this.vacationRequestsService.findOneWithValidation({
        id: requestId,
        slackTeamId,
      });

      this.assertLoggable(request, user);

      const plan = await this.plan(request);

      if (!plan) {
        throw new ValidationError('This time off has no project to log on.');
      }

      const { offer, teamId } = plan;
      const existing = await this.timeEntriesService.findMany({
        userId: user.id,
        dateFrom: offer.dates[0],
        dateTo: offer.dates[offer.dates.length - 1],
        slackTeamId,
      });
      const onProject = existing.filter(
        ({ project_id }) => project_id === offer.projectId,
      );
      const elsewhere = existing.filter(
        ({ project_id, vacation_request_id }) =>
          vacation_request_id === request.id && project_id !== offer.projectId,
      );
      const taken = new Set(
        [...onProject, ...elsewhere].map(({ work_date }) =>
          getDateOnly(work_date),
        ),
      );
      const own = onProject.filter(
        ({ vacation_request_id }) => vacation_request_id === request.id,
      );
      const free = offer.dates.filter((date) => !taken.has(date));

      if (free.length) {
        await this.vacationTimeService.log({
          userId: user.id,
          teamId,
          projectId: offer.projectId,
          minutes: offer.minutes,
          dates: free,
          vacationRequestId: request.id,
          // plan() returned an offer: the type is one of them.
          description: TIME_OFF_DESCRIPTIONS[request.type as TimeOffLeaveType],
          slackTeamId,
        });
      }

      return {
        offer,
        logged: free,
        linked: {
          dates: [
            ...own.map(({ work_date }) => getDateOnly(work_date)),
            ...free,
          ],
          minutes: sumMinutes(own) + free.length * offer.minutes,
          otherProjects: this.byProject(elsewhere),
        },
      };
    });
  }

  private byProject(entries: ITimeEntryViewModel[]) {
    const days = new Map<string, string[]>();

    for (const { project, work_date } of entries) {
      const name = project?.name ?? 'another project';

      days.set(name, [...(days.get(name) ?? []), getDateOnly(work_date)]);
    }

    return [...days].map(([projectName, dates]) => ({
      projectName,
      dates: dates.sort(),
    }));
  }

  private assertLoggable(
    request: IVacationRequestViewModel,
    user: IUserViewModel,
  ) {
    if (request.user_id !== user.id) {
      throw new ForbiddenException('You can only log your own time off.');
    }

    // Imported leave is logged as no time, so a click on it is refused as
    // on time off that isn't approved: no offer ever showed one.
    if (!loggable(request)) {
      throw new ValidationError('This time off is no longer approved.');
    }
  }

  private async plan(
    request: IVacationRequestViewModel,
  ): Promise<ITimeOffPlan | null> {
    if (!loggable(request) || !isTimeOffLeaveType(request.type)) {
      return null;
    }

    const slackTeamId = request.slack_team_id;
    const settings = await this.settingsService.get(slackTeamId);
    const projectId = settings.projectIds[request.type];

    if (!projectId) {
      return null;
    }

    // The stored project may have been archived since.
    const [project] = await this.projectsService.findMany({
      ids: [projectId],
      slackTeamId,
    });

    if (!project) {
      return null;
    }

    // Someone deactivated since gets no offer.
    const requester = await this.usersService.findOne({
      id: request.user_id,
      slackTeamId,
      includeInactive: true,
    });

    if (!requester?.is_active) {
      return null;
    }

    // The holidays of the policy the requester's team follows.
    const { vacationPolicyId } = await this.teamRulesService.forTeam(
      requester.team_id,
      slackTeamId,
    );
    const dates = await this.daysCalculationService.workingDates(
      new Date(request.start_date),
      new Date(request.end_date),
      vacationPolicyId,
      slackTeamId,
    );

    if (!dates.length) {
      return null;
    }

    return {
      offer: {
        requestId: request.id,
        projectId: project.id,
        projectName: project.name,
        minutes: settings.minutesPerDay,
        dates,
      },
      teamId: requester.team_id,
    };
  }
}
