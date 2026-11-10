import { Injectable } from '@nestjs/common';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationType from '@common/enums/vacation-type.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

export interface IColleagueOff {
  name: string;
  start_date: string;
  end_date: string;
}

const MAX_COLLEAGUES_SHOWN = 5;

// What people should know beside a request: who else on the team is off
// then. Approvers see every kind of time off, as in Slack; the requester
// doesn't learn about a colleague's sick leave.
@Injectable()
export class TimeOffContextService {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
  ) {}

  // Teammates whose approved or pending time off shares a day with the
  // request: the team the request was made in, the requester left out.
  public async findColleaguesOff(
    request: IVacationRequestViewModel,
    { forRequester }: { forRequester: boolean },
  ): Promise<IColleagueOff[]> {
    if (!request.team_id) {
      return [];
    }

    const overlapping = await this.vacationRequestsService.findMany({
      slackTeamId: request.slack_team_id,
      teamId: request.team_id,
      statuses: [VacationRequestStatus.Approved, VacationRequestStatus.Pending],
      overlapping: {
        startDate: request.start_date,
        endDate: request.end_date,
      },
    });

    return overlapping
      .filter(({ user_id }) => user_id !== request.user_id)
      .filter(({ type }) => !forRequester || type !== VacationType.SickLeave)
      .slice(0, MAX_COLLEAGUES_SHOWN)
      .map(({ user, start_date, end_date }) => ({
        name: user?.name ?? 'Someone',
        start_date,
        end_date,
      }));
  }
}
