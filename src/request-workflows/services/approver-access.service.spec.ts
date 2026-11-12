import { JobsService } from 'src/common/jobs/jobs.service';
import {
  APPROVER_ACCESS_JOB,
  ApproverAccessService,
} from 'src/request-workflows/services/approver-access.service';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { UserAccessChangedEvent } from 'src/users/events/users.events';
import { UsersService } from 'src/users/services/users.service';

describe('ApproverAccessService', () => {
  // In the transaction that changes the user: the job is saved with it.
  it('enqueues the hand-over of a changed user', async () => {
    const enqueue = jest.fn().mockResolvedValue(undefined);
    const service = new ApproverAccessService(
      {} as UsersService,
      {} as RequestWorkflowStepsService,
      {} as RequestWorkflowService,
      { enqueue } as unknown as JobsService,
    );

    await service.handleAccessChanged(
      new UserAccessChangedEvent('user-1', 'slack-team-1'),
    );

    expect(enqueue).toHaveBeenCalledWith(APPROVER_ACCESS_JOB, {
      userId: 'user-1',
      slackTeamId: 'slack-team-1',
    });
  });
});
