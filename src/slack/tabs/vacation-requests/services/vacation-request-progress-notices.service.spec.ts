import { JobsService } from 'src/common/jobs/jobs.service';
import { RequestWorkflowStepCommentAddedEvent } from 'src/request-workflows/events/request-workflow-step-comment.events';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import {
  COMMENT_NOTICE_JOB,
  SENT_NOTICE_JOB,
  VacationRequestProgressNoticesService,
} from 'src/slack/tabs/vacation-requests/services/vacation-request-progress-notices.service';
import { VacationRequestSentForApprovalEvent } from 'src/vacation-requests/events/vacation-request.events';
import { TimeOffContextService } from 'src/vacation-requests/services/time-off-context.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';

// The listeners run in the transaction of the change (the workflow made, the
// comment written): they enqueue the requester's DM and run nothing.
describe('VacationRequestProgressNoticesService', () => {
  let enqueue: jest.Mock;
  let service: VacationRequestProgressNoticesService;

  beforeEach(() => {
    enqueue = jest.fn().mockResolvedValue(undefined);
    service = new VacationRequestProgressNoticesService(
      {} as SlackCommunicationService,
      {} as VacationRequestsService,
      {} as RequestWorkflowStepsService,
      {} as TimeOffContextService,
      {} as RequestWorkflowStepCommentsService,
      { enqueue } as unknown as JobsService,
    );
  });

  it('enqueues the DM saying where a request went', async () => {
    await service.handleSentForApproval(
      new VacationRequestSentForApprovalEvent(
        {
          id: 'r1',
          slack_team_id: 'slack-team-1',
        } as IVacationRequestViewModel,
        null,
      ),
    );

    expect(enqueue).toHaveBeenCalledWith(SENT_NOTICE_JOB, {
      requestId: 'r1',
      slackTeamId: 'slack-team-1',
      fallback: null,
    });
  });

  it("enqueues the DM of an approver's comment", async () => {
    await service.handleCommentAdded(
      new RequestWorkflowStepCommentAddedEvent({
        id: 'c1',
        slack_team_id: 'slack-team-1',
      } as IWorkflowStepCommentViewModel),
    );

    expect(enqueue).toHaveBeenCalledWith(COMMENT_NOTICE_JOB, {
      commentId: 'c1',
      slackTeamId: 'slack-team-1',
    });
  });
});
