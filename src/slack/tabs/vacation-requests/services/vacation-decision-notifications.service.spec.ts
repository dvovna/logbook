import { Logger } from '@nestjs/common';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { JobsService } from 'src/common/jobs/jobs.service';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import {
  DecisionNotificationJob,
  VacationDecisionNotificationsService,
} from 'src/slack/tabs/vacation-requests/services/vacation-decision-notifications.service';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
import { TimeOffOfferView } from 'src/slack/tabs/vacation-requests/views/time-off-offer.view';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { UsersService } from 'src/users/services/users.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { VacationRequestDecidedEvent } from 'src/vacation-requests/events/vacation-request.events';

const SLACK_TEAM_ID = 'slack-team-1';

const approved = {
  id: 'r1',
  user_id: 'u1',
  user: { slack_id: 'U_REQUESTER', name: 'Mia' },
  status: VacationRequestStatus.Approved,
  type: VacationType.AnnualLeave,
  start_date: '2026-06-22',
  end_date: '2026-06-26',
  days: 5,
  working_days: 5,
  slack_team_id: SLACK_TEAM_ID,
} as unknown as IVacationRequestViewModel;

describe('VacationDecisionNotificationsService', () => {
  let handlers: Map<string, (job: unknown) => Promise<void>>;
  let postMessage: jest.Mock;
  let offerFor: jest.Mock;
  let getButtonBlocks: jest.Mock;
  let warn: jest.SpyInstance;
  let jobs: { enqueue: jest.Mock; enqueueMany: jest.Mock };
  let forTeam: jest.Mock;
  let findRequest: jest.Mock;
  let service: VacationDecisionNotificationsService;

  beforeEach(() => {
    handlers = new Map();
    jobs = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
    };
    forTeam = jest.fn().mockResolvedValue({
      notificationRecipients: ['U_LEAD', 'U_PAYROLL'],
    });
    postMessage = jest.fn().mockResolvedValue(undefined);
    offerFor = jest.fn();
    getButtonBlocks = jest
      .fn()
      .mockReturnValue([{ type: 'actions', block_id: 'offer', elements: [] }]);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    findRequest = jest.fn().mockResolvedValue(approved);

    service = new VacationDecisionNotificationsService(
      { forTeam } as unknown as TeamRulesService,
      { postMessage } as unknown as SlackCommunicationService,
      { findOne: findRequest } as unknown as VacationRequestsService,
      {
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as RequestWorkflowStepCommentsService,
      {
        findOneWithValidation: jest
          .fn()
          .mockResolvedValue({ id: 'hr', slack_id: 'U_HR' }),
      } as unknown as UsersService,
      {
        ...jobs,
        define: (name: string, handler: (job: unknown) => Promise<void>) =>
          handlers.set(name, handler),
      } as unknown as JobsService,
      { offerFor } as unknown as TimeOffLoggingService,
      { getButtonBlocks } as unknown as TimeOffOfferView,
    );
    service.onModuleInit();
  });

  afterEach(() => warn.mockRestore());

  const job = {
    requestId: approved.id,
    slackTeamId: SLACK_TEAM_ID,
    decidedById: 'hr',
    status: VacationRequestStatus.Approved,
  };

  const notifyRequester = () =>
    handlers.get(DecisionNotificationJob.Requester)!(job);

  // In the transaction that decides the request: enqueue, not run.
  it('saves the jobs that tell the requester and the recipients of an approval', async () => {
    await service.handleDecided({
      request: approved,
      decidedBy: { id: 'hr' },
    } as VacationRequestDecidedEvent);

    expect(jobs.enqueue.mock.calls).toEqual([
      [DecisionNotificationJob.Requester, job],
      [DecisionNotificationJob.Recipients, job],
    ]);
  });

  it("saves only the requester's job for a rejection", async () => {
    await service.handleDecided({
      request: { ...approved, status: VacationRequestStatus.Rejected },
      decidedBy: { id: 'hr' },
    } as VacationRequestDecidedEvent);

    expect(jobs.enqueue.mock.calls).toEqual([
      [
        DecisionNotificationJob.Requester,
        { ...job, status: VacationRequestStatus.Rejected },
      ],
    ]);
  });

  // HR approved it with Edit Request, then rejected it: the approval's jobs
  // that haven't run yet, or run again, tell of nothing.
  it.each([
    ['decided otherwise since', VacationRequestStatus.Rejected],
    ['pending again', VacationRequestStatus.Pending],
    ['canceled', VacationRequestStatus.Canceled],
  ])('tells nobody of a request %s', async (_change, status) => {
    findRequest.mockResolvedValue({ ...approved, status });

    await notifyRequester();
    await handlers.get(DecisionNotificationJob.Recipients)!(job);
    await handlers.get(DecisionNotificationJob.Recipient)!({
      ...job,
      recipientSlackId: 'U_LEAD',
    });

    expect(postMessage).not.toHaveBeenCalled();
    expect(jobs.enqueueMany).not.toHaveBeenCalled();
  });

  it('tells of a job saved before jobs carried their status', async () => {
    const { status: _status, ...older } = job;

    await handlers.get(DecisionNotificationJob.Requester)!(older);

    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('tells nobody of a request deleted since', async () => {
    findRequest.mockResolvedValue(null);

    await notifyRequester();

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('saves a job per recipient before its own job ends', async () => {
    await handlers.get(DecisionNotificationJob.Recipients)!(job);

    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      DecisionNotificationJob.Recipient,
      [
        { ...job, recipientSlackId: 'U_LEAD' },
        { ...job, recipientSlackId: 'U_PAYROLL' },
      ],
    );
  });

  it('tells the requester of an approval with the button to log it', async () => {
    offerFor.mockResolvedValue({ requestId: approved.id });

    await notifyRequester();

    expect(postMessage).toHaveBeenCalledWith(
      'U_REQUESTER',
      expect.objectContaining({
        blocks: expect.arrayContaining([
          expect.objectContaining({ block_id: 'offer' }),
        ]),
      }),
      SLACK_TEAM_ID,
    );
  });

  it('still tells the requester, without the button, when the offer fails', async () => {
    offerFor.mockRejectedValue(new Error('connection lost'));

    await notifyRequester();

    expect(postMessage).toHaveBeenCalledTimes(1);
    const [channel, message] = postMessage.mock.calls[0];

    expect(channel).toBe('U_REQUESTER');
    expect(message.text).toBe(
      'Your Annual leave request for 22–26 Jun 2026 was approved',
    );
    expect(message.blocks).toHaveLength(2);
    expect(getButtonBlocks).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'No offer to log time off r1 as time: connection lost',
    );
  });
});
