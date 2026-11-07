import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { VacationWorkflowEventEnum } from '@common/enums/vacation-workflow-event.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { UsersService } from '@modules/users/services/users.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { VacationWorkflowFinished } from '@common/events/vacation-workflow.events';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestDecidedEvent } from '@modules/vacation-requests/events/vacation-request.events';

// A finished workflow decides its request: approved or rejected.
@Injectable()
export class RequestWorkflowProcessingService {
  private readonly logger = new Logger(RequestWorkflowProcessingService.name);

  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(VacationWorkflowEventEnum.Finished)
  public async handleWorkflowFinished({ workflow }: VacationWorkflowFinished) {
    const [request, approvedBy] = await Promise.all([
      this.vacationRequestsService.findOne({
        id: workflow.requestId,
        slackTeamId: workflow.slackTeamId,
      }),
      this.usersService.findOneWithValidation({
        id: workflow.approvedBy,
        slackTeamId: workflow.slackTeamId,
        includeInactive: true,
      }),
    ]);

    if (!request) {
      return;
    }

    const statusToSet =
      workflow.status === RequestWorkflowStatus.Approved
        ? VacationRequestStatus.Approved
        : VacationRequestStatus.Rejected;

    // Two approvers deciding at once both finish the workflow; only the
    // first one changes the request and tells people.
    const updatedRequest = await this.vacationRequestsService.finishPending(
      {
        id: request.id,
        slackTeamId: request.slack_team_id,
      },
      statusToSet,
      approvedBy,
    );

    if (!updatedRequest) {
      this.logger.warn(
        `Request ${request.id} is no longer pending (${request.status}), not finishing it again`,
      );
      return;
    }

    // Telling people is the Slack side's (VacationDecisionNotificationsService).
    this.eventEmitter.emit(
      VacationRequestEvent.Decided,
      new VacationRequestDecidedEvent(
        updatedRequest,
        approvedBy,
        workflow.reviewComments,
      ),
    );
  }
}
