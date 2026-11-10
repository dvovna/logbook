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
import { TimeOffOfferService } from 'src/slack/tabs/vacation-requests/services/time-off-offer.service';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
import { TimeOffLoggingService } from 'src/time-off-logging/services/time-off-logging.service';
import { UsersService } from 'src/users/services/users.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';

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
  let getBlocks: jest.Mock;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    handlers = new Map();
    postMessage = jest.fn().mockResolvedValue(undefined);
    offerFor = jest.fn();
    getBlocks = jest
      .fn()
      .mockReturnValue([{ type: 'actions', block_id: 'offer', elements: [] }]);
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    new VacationDecisionNotificationsService(
      {} as TeamRulesService,
      { postMessage } as unknown as SlackCommunicationService,
      {
        findOne: jest.fn().mockResolvedValue(approved),
      } as unknown as VacationRequestsService,
      {
        findMany: jest.fn().mockResolvedValue([]),
      } as unknown as RequestWorkflowStepCommentsService,
      {
        findOneWithValidation: jest
          .fn()
          .mockResolvedValue({ id: 'hr', slack_id: 'U_HR' }),
      } as unknown as UsersService,
      {
        define: (name: string, handler: (job: unknown) => Promise<void>) =>
          handlers.set(name, handler),
      } as unknown as JobsService,
      { offerFor } as unknown as TimeOffLoggingService,
      { getBlocks } as unknown as TimeOffOfferService,
    ).onModuleInit();
  });

  afterEach(() => warn.mockRestore());

  const notifyRequester = () =>
    handlers.get(DecisionNotificationJob.Requester)!({
      requestId: approved.id,
      slackTeamId: SLACK_TEAM_ID,
      decidedById: 'hr',
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
    expect(getBlocks).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'No offer to log time off r1 as time: connection lost',
    );
  });
});
