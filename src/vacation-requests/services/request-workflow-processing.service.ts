import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VacationWorkflowEventEnum } from 'src/common/enums/vacation-workflow-event.enum';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { UsersService } from 'src/users/users.service';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import { RequestWorkflowStatus } from 'src/common/enums/request-workflow-status.enum';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import TeamsService from 'src/teams/services/teams.service';
import { VacationWorkflowFinished } from 'src/common/events/vacation-workflow.events';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from 'src/slack/common/views/data/vacation-type-display-name';

@Injectable()
export class RequestWorkflowProcessingService {
  private readonly logger = new Logger(RequestWorkflowProcessingService.name);

  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly communicationService: SlackCommunicationService,
  ) {}

  @OnEvent(VacationWorkflowEventEnum.Finished)
  public async handleWorkflowFinished({ workflow }: VacationWorkflowFinished) {
    const [request, approvedBy] = await Promise.all([
      this.vacationRequestsService.findOneWithValidation({
        id: workflow.requestId,
        slackTeamId: workflow.slackTeamId,
      }),
      this.usersService.findOneWithValidation({
        id: workflow.approvedBy,
        slackTeamId: workflow.slackTeamId,
      }),
    ]);

    const statusToSet =
      workflow.status === RequestWorkflowStatus.Approved
        ? VacationRequestStatus.Approved
        : VacationRequestStatus.Rejected;

    if (
      statusToSet === request.status ||
      request.status === VacationRequestStatus.Canceled
    ) {
      this.logger.warn('Request status is already set. Skipping update.');
      return;
    }

    const updatedRequest = await this.vacationRequestsService.update(
      {
        id: request.id,
        slackTeamId: request.slack_team_id,
      },
      {
        status: statusToSet,
      },
      approvedBy,
    );

    if (updatedRequest.status === VacationRequestStatus.Approved) {
      await this.notifyOnApproval(updatedRequest, approvedBy);
    }

    await this.notifyUser(updatedRequest);
  }

  private async notifyUser(request: IVacationRequestViewModel) {
    const message =
      request.status === VacationRequestStatus.Approved
        ? {
          text: `✅ Great news! Your vacation request has been approved 🎉

${this.getRequestDetails(request)}

🧳 Pack your bags, ${request.user?.name}! Don’t forget sunscreen 😎`,
        }
        : {
          text: `❌ Bad news... Your vacation request has been rejected 💔

${this.getRequestDetails(request)}

💼 Looks like it's back to work… but coffee is waiting ☕🙂`,
        };

    await this.communicationService.postMessage(
      request.user!.slack_id,
      message,
      request.slack_team_id,
    );
  }

  private getRequestDetails(request: IVacationRequestViewModel) {
    return `
📅 ${request.start_date} → ${request.end_date} (${request.days} calendar days, ${request.working_days} working days)
🏖️ Type: ${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]}
    `;
  }

  private async notifyOnApproval(
    request: IVacationRequestViewModel,
    approvedBy: IUserViewModel,
  ) {
    const team = await this.teamsService.findOneWithValidation({
      id: request.team_id,
      slackTeamId: request.slack_team_id,
    });

    if (team.approval_notification_recipients?.length) {
      for (const recipientSlackId of team.approval_notification_recipients) {
        await this.communicationService.postMessage(
          recipientSlackId,
          this.getNotificationMessage(request),
          approvedBy.slack_team_id,
        );
      }
    }
  }

  private getNotificationMessage(request: IVacationRequestViewModel) {
    return {
      text: `✅ Vacation request approved for ${request.user!.name}:

📅 ${request.start_date} → ${request.end_date} (${request.days} calendar days, ${request.working_days} working days)
🏖️ Type: ${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]}`,
    };
  }
}
