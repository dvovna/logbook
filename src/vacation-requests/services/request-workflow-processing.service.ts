import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { JobsService } from '@common/jobs/jobs.service';
import { VacationWorkflowEventEnum } from '@common/enums/vacation-workflow-event.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { UsersService } from '@modules/users/services/users.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { VacationWorkflowFinished } from '@modules/request-workflows/events/vacation-workflow.events';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestDecidedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { TransactionService } from 'src/database/transaction.service';

export const FINISH_REQUEST_JOB = 'vacation-request-finish';

interface IFinishRequestJob {
  requestId: string;
  slackTeamId: string;
  status: RequestWorkflowStatus;
  decidedById: string;
  // What the approver wrote in the Reject form.
  rejectionReason?: string;
}

// A finished workflow decides its request: approved or rejected. A job, so
// that a database failure is retried instead of leaving the request pending
// after everyone decided.
@Injectable()
export class RequestWorkflowProcessingService implements OnModuleInit {
  private readonly logger = new Logger(RequestWorkflowProcessingService.name);

  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly usersService: UsersService,
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly jobs: JobsService,
    private readonly transactions: TransactionService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IFinishRequestJob>(FINISH_REQUEST_JOB, (job) =>
      this.finishRequest(job),
    );
  }

  // Runs inside the transaction of the last decision (emitAsync), so the job
  // is saved with it; a failure here rolls the decision back to be retried.
  @OnEvent(VacationWorkflowEventEnum.Finished, { suppressErrors: false })
  public async handleWorkflowFinished({ workflow }: VacationWorkflowFinished) {
    await this.jobs.enqueue<IFinishRequestJob>(FINISH_REQUEST_JOB, {
      requestId: workflow.requestId,
      slackTeamId: workflow.slackTeamId,
      status: workflow.status,
      decidedById: workflow.approvedBy,
      rejectionReason: workflow.rejectionReason,
    });
  }

  private async finishRequest({
    requestId,
    slackTeamId,
    status,
    decidedById,
    rejectionReason,
  }: IFinishRequestJob) {
    const decidedBy = await this.usersService.findOneWithValidation({
      id: decidedById,
      slackTeamId,
      includeInactive: true,
    });

    // The request's outcome and the jobs that tell people of it commit
    // together (emitAsync): a retry finds the request decided and stops, so
    // a job saved after the commit could be lost for good.
    await this.transactions.transaction(async () => {
      // Two approvers deciding at once both finish the workflow, and a retry
      // may follow a run that got this far; only the first one changes the
      // request and tells people.
      const updatedRequest = await this.vacationRequestsService.finishPending(
        { id: requestId, slackTeamId },
        status === RequestWorkflowStatus.Approved
          ? VacationRequestStatus.Approved
          : VacationRequestStatus.Rejected,
        decidedBy,
        rejectionReason,
      );

      if (!updatedRequest) {
        this.logger.warn(
          `Request ${requestId} is no longer pending, not finishing it again`,
        );
        return;
      }

      const comments = await this.requestWorkflowStepCommentsService.findMany({
        requestId,
        slackTeamId,
      });

      // Telling people is the Slack side's
      // (VacationDecisionNotificationsService).
      await this.eventEmitter.emitAsync(
        VacationRequestEvent.Decided,
        new VacationRequestDecidedEvent(updatedRequest, decidedBy, comments),
      );
    });
  }
}
