import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { JobsService } from '@common/jobs/jobs.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { VacationRequestUpdatedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import {
  TIME_OFF_CANCELED_JOB,
  TimeOffCancelNoticesService,
} from '@modules/slack/tabs/vacation-requests/services/time-off-cancel-notices.service';

const request = (status: VacationRequestStatus) =>
  ({
    id: 'request-1',
    slack_team_id: 'slack-team-1',
    status,
  }) as IVacationRequestViewModel;

const requester = { id: 'user-1' } as IUserViewModel;

describe('TimeOffCancelNoticesService', () => {
  let jobs: { enqueue: jest.Mock };
  let service: TimeOffCancelNoticesService;

  beforeEach(() => {
    jobs = { enqueue: jest.fn() };
    // Only the jobs matter to the listener.
    const unused = {} as never;
    service = new TimeOffCancelNoticesService(
      unused,
      unused,
      unused,
      unused,
      unused,
      jobs as unknown as JobsService,
    );
  });

  const update = (from: VacationRequestStatus, to: VacationRequestStatus) =>
    service.handleUpdated(
      new VacationRequestUpdatedEvent(request(to), requester, request(from)),
    );

  it('plans the notices of approved time off that is canceled', async () => {
    await update(
      VacationRequestStatus.Approved,
      VacationRequestStatus.Canceled,
    );

    expect(jobs.enqueue).toHaveBeenCalledWith(TIME_OFF_CANCELED_JOB, {
      requestId: 'request-1',
      slackTeamId: 'slack-team-1',
      canceledById: 'user-1',
    });
  });

  it.each([
    [VacationRequestStatus.Pending, VacationRequestStatus.Canceled],
    [VacationRequestStatus.Approved, VacationRequestStatus.Rejected],
    [VacationRequestStatus.Canceled, VacationRequestStatus.Canceled],
  ])('tells nobody of a change from %s to %s', async (from, to) => {
    await update(from, to);

    expect(jobs.enqueue).not.toHaveBeenCalled();
  });
});
