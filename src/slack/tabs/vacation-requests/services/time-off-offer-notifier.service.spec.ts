import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { JobsService } from 'src/common/jobs/jobs.service';
import ProjectsService from 'src/projects/services/projects.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { TIME_OFF_OFFER_JOB } from 'src/slack/tabs/vacation-requests/constants/time-off-offer';
import { TimeOffOfferNotifier } from 'src/slack/tabs/vacation-requests/services/time-off-offer-notifier.service';
import { TimeOffOfferView } from 'src/slack/tabs/vacation-requests/views/time-off-offer.view';
import { TimeOffChangedEvent } from 'src/time-off-logging/events/time-off.events';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { IRemovedVacationTime } from 'src/time-off-logging/types/vacation-time.types';
import { IUserViewModel } from 'src/users/types/user.interface';
import { UsersService } from 'src/users/services/users.service';
import { VacationRequestCreatedEvent } from 'src/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';

const SLACK_TEAM_ID = 'slack-team-1';

const approved = {
  id: 'r1',
  user_id: 'u1',
  status: VacationRequestStatus.Approved,
  type: VacationType.AnnualLeave,
  start_date: '2026-06-22',
  end_date: '2026-06-26',
  slack_team_id: SLACK_TEAM_ID,
} as IVacationRequestViewModel;

const hr = { id: 'hr' } as IUserViewModel;

const removedTime: IRemovedVacationTime = {
  deleted: 5,
  owners: [{ userId: 'u1', minutes: 2400, projectIds: ['p1'] }],
  billedDates: [],
};

// The listeners run in the transaction of the change: they enqueue the DMs'
// jobs, all of a change in one statement, and run none.
describe('TimeOffOfferNotifier', () => {
  let enqueueMany: jest.Mock;
  let notifier: TimeOffOfferNotifier;

  beforeEach(() => {
    enqueueMany = jest.fn().mockResolvedValue(undefined);
    notifier = new TimeOffOfferNotifier(
      {} as TimeOffLoggingService,
      {} as VacationRequestsService,
      {} as SlackCommunicationService,
      { enqueueMany } as unknown as JobsService,
      {} as UsersService,
      {} as ProjectsService,
      {} as TimeOffOfferView,
    );
  });

  const offer = { requestId: 'r1', slackTeamId: SLACK_TEAM_ID };

  it('offers to log a request created approved', async () => {
    await notifier.handleCreated(new VacationRequestCreatedEvent(approved, hr));

    expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, [offer]);
  });

  it('offers nothing for a pending request', async () => {
    await notifier.handleCreated(
      new VacationRequestCreatedEvent(
        { ...approved, status: VacationRequestStatus.Pending },
        hr,
      ),
    );

    expect(enqueueMany).not.toHaveBeenCalled();
  });

  it('tells the requester what time went, with the new offer, in one DM', async () => {
    await notifier.handleUpdated(
      new TimeOffChangedEvent(
        { ...approved, end_date: '2026-06-25' },
        hr,
        approved,
        removedTime,
      ),
    );

    expect(enqueueMany).toHaveBeenCalledTimes(1);
    expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, [
      {
        ...offer,
        removed: expect.objectContaining({ userId: 'u1', change: 'changed' }),
      },
    ]);
  });

  it('tells whose time went apart from the offer to the new person', async () => {
    await notifier.handleUpdated(
      new TimeOffChangedEvent(
        { ...approved, user_id: 'u2' },
        hr,
        approved,
        removedTime,
      ),
    );

    expect(enqueueMany).toHaveBeenCalledTimes(1);
    expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, [
      {
        ...offer,
        removed: expect.objectContaining({ userId: 'u1', change: 'moved' }),
        removalOnly: true,
      },
      offer,
    ]);
  });

  // The decision DM (VacationDecisionNotificationsService) holds the button.
  it.each([
    VacationRequestStatus.Pending,
    VacationRequestStatus.Rejected,
    VacationRequestStatus.Canceled,
  ])(
    'offers nothing apart when an edit approves a %s request',
    async (from) => {
      await notifier.handleUpdated(
        new TimeOffChangedEvent(
          approved,
          hr,
          { ...approved, status: from },
          {
            deleted: 0,
            owners: [],
            billedDates: [],
          },
        ),
      );

      expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, []);
    },
  );

  it('still tells what time went when an edit approves the request', async () => {
    await notifier.handleUpdated(
      new TimeOffChangedEvent(
        approved,
        hr,
        { ...approved, status: VacationRequestStatus.Rejected },
        removedTime,
      ),
    );

    expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, [
      {
        ...offer,
        removed: expect.objectContaining({ userId: 'u1', change: 'changed' }),
        removalOnly: true,
      },
    ]);
  });

  it('tells what time went when an edit rejects the request', async () => {
    await notifier.handleUpdated(
      new TimeOffChangedEvent(
        { ...approved, status: VacationRequestStatus.Rejected },
        hr,
        approved,
        removedTime,
      ),
    );

    expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, [
      {
        ...offer,
        removed: expect.objectContaining({ userId: 'u1', change: 'rejected' }),
        removalOnly: true,
      },
    ]);
  });

  it('tells whose time went with a deleted request', async () => {
    await notifier.handleDeleted(
      new TimeOffChangedEvent(approved, hr, undefined, removedTime),
    );

    expect(enqueueMany).toHaveBeenCalledWith(TIME_OFF_OFFER_JOB, [
      {
        ...offer,
        removed: expect.objectContaining({ userId: 'u1', change: 'deleted' }),
        removalOnly: true,
      },
    ]);
  });
});
