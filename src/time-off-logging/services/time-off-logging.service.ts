import { ForbiddenException, Injectable } from '@nestjs/common';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { ValidationError } from '@common/errors/validation.error';
import { getDateOnly } from '@common/utils/date.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { UsersService } from '@modules/users/services/users.service';
import TeamsService from '@modules/teams/services/teams.service';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { VacationDaysCalculationService } from '@modules/vacation-requests/services/vacation-days-calculation.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import ProjectsService from 'src/projects/services/projects.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TransactionService } from 'src/database/transaction.service';
import { TimeOffSettingsService } from 'src/time-off-logging/services/time-off-settings.service';
import { isTimeOffLeaveType } from 'src/time-off-logging/constants/time-off-leave-types';

// What logging an approved time off would write.
export interface ITimeOffOffer {
  requestId: string;
  projectId: string;
  projectName: string;
  // On each day.
  minutes: number;
  // The working days of the time off, as 'YYYY-MM-DD'.
  dates: string[];
}

interface ITimeOffPlan {
  offer: ITimeOffOffer;
  // The requester's team now.
  teamId: string | null;
}

// Turns an approved time off into approved time entries on the project of its
// leave type, one per working day.
@Injectable()
export class TimeOffLoggingService {
  public constructor(
    private readonly settingsService: TimeOffSettingsService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly daysCalculationService: VacationDaysCalculationService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly transactions: TransactionService,
  ) {}

  // Null unless the time off is approved and its type has an active project.
  public async offerFor(
    request: IVacationRequestViewModel,
  ): Promise<ITimeOffOffer | null> {
    return (await this.plan(request))?.offer ?? null;
  }

  // The requester's own time off only. A day that has any time of theirs on
  // the project is skipped, so a second run, or a second click at the same
  // moment, writes nothing more.
  public async log(
    user: IUserViewModel,
    requestId: string,
  ): Promise<{ offer: ITimeOffOffer; logged: string[]; skipped: string[] }> {
    const slackTeamId = user.slack_team_id;

    return this.transactions.transaction(async () => {
      await this.transactions.lock(`time-off:${requestId}`);

      const request = await this.vacationRequestsService.findOneWithValidation({
        id: requestId,
        slackTeamId,
      });

      if (request.user_id !== user.id) {
        throw new ForbiddenException('You can only log your own time off.');
      }

      if (request.status !== VacationRequestStatus.Approved) {
        throw new ValidationError('This time off is no longer approved.');
      }

      const plan = await this.plan(request);

      if (!plan) {
        throw new ValidationError('This time off has no project to log on.');
      }

      const { offer, teamId } = plan;
      const logged = await this.timeEntriesService.findMany({
        userId: user.id,
        projectId: offer.projectId,
        dateFrom: offer.dates[0],
        dateTo: offer.dates[offer.dates.length - 1],
        slackTeamId,
      });
      const taken = new Set(
        logged.map(({ work_date }) => getDateOnly(work_date)),
      );
      const free = offer.dates.filter((date) => !taken.has(date));

      if (free.length) {
        await this.timeEntriesService.createForVacation({
          userId: user.id,
          teamId,
          projectId: offer.projectId,
          minutes: offer.minutes,
          dates: free,
          vacationRequestId: request.id,
          slackTeamId,
        });
      }

      return {
        offer,
        logged: free,
        skipped: offer.dates.filter((date) => taken.has(date)),
      };
    });
  }

  private async plan(
    request: IVacationRequestViewModel,
  ): Promise<ITimeOffPlan | null> {
    if (
      request.status !== VacationRequestStatus.Approved ||
      !isTimeOffLeaveType(request.type)
    ) {
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

    const requester = await this.usersService.findOneWithValidation({
      id: request.user_id,
      slackTeamId,
    });
    const team = requester.team_id
      ? await this.teamsService.findOne({
          id: requester.team_id,
          slackTeamId,
        })
      : null;
    const dates = await this.daysCalculationService.workingDates(
      new Date(request.start_date),
      new Date(request.end_date),
      team?.vacation_policy_id ?? null,
      slackTeamId,
    );

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
