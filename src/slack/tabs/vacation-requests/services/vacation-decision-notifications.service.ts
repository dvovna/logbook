import { formatDateRange } from '@common/utils/date.utils';
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import * as pluralize from 'pluralize';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { getApproverCommentLines } from '@modules/slack/common/utils/view.utils';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackMessagePayloadInterface } from '@modules/slack-communication/types/slack-message-payload.interface';
import TeamsService from '@modules/teams/services/teams.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestDecidedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

// Tells the requester how their request was decided and, when it was approved,
// the team's approval_notification_recipients.
@Injectable()
export class VacationDecisionNotificationsService {
  private readonly logger = new Logger(
    VacationDecisionNotificationsService.name,
  );

  public constructor(
    private readonly teamsService: TeamsService,
    private readonly communicationService: SlackCommunicationService,
  ) {}

  @OnEvent(VacationRequestEvent.Decided)
  public async handleDecided({
    request,
    decidedBy,
    comments,
  }: VacationRequestDecidedEvent) {
    if (request.status === VacationRequestStatus.Approved) {
      await this.notifyOnApproval(request, decidedBy, comments);
    }

    await this.notifyUser(request, decidedBy, comments);
  }

  // What was decided and by whom, in plain words: the same message for every
  // workspace, whatever its mood.
  private getUserNotificationMessage(
    request: IVacationRequestViewModel,
    decidedBy: IUserViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): SlackMessagePayloadInterface {
    const approved = request.status === VacationRequestStatus.Approved;
    const type = VACATION_TYPE_DISPLAY_NAME_MAP[request.type];
    const dates = formatDateRange(request.start_date, request.end_date);
    const commentLines = getApproverCommentLines(comments).join('\n');

    return {
      text: approved
        ? `Your ${type} request for ${dates} was approved`
        : `Your ${type} request for ${dates} was rejected`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: [
              approved
                ? '✅ *Your time off request was approved*'
                : '❌ *Your time off request was rejected*',
              this.getRequestDetails(request),
              commentLines,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        } as KnownBlock,
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${approved ? 'Approved' : 'Rejected'} by <@${decidedBy.slack_id}>`,
            },
          ],
        } as KnownBlock,
      ],
    };
  }

  private async notifyUser(
    request: IVacationRequestViewModel,
    decidedBy: IUserViewModel,
    comments: IWorkflowStepCommentViewModel[] = [],
  ) {
    await this.communicationService.postMessage(
      request.user!.slack_id,
      this.getUserNotificationMessage(request, decidedBy, comments),
      request.slack_team_id,
    );
  }

  // '*Annual Leave* · 6–10 Jul 2026 (5 days, 5 working)'
  private getRequestDetails(request: IVacationRequestViewModel) {
    return `*${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]}* · ${formatDateRange(request.start_date, request.end_date)} (${pluralize('day', request.days, true)}, ${request.working_days} working)`;
  }

  private async notifyOnApproval(
    request: IVacationRequestViewModel,
    approvedBy: IUserViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ) {
    if (!request.team_id) {
      this.logger.warn(
        `Request ${request.id} has no team_id. Skipping approval notification.`,
      );

      return;
    }

    const team = await this.teamsService.findOneWithValidation({
      id: request.team_id,
      slackTeamId: request.slack_team_id,
    });

    if (team.approval_notification_recipients?.length) {
      for (const recipientSlackId of team.approval_notification_recipients) {
        await this.communicationService.postMessage(
          recipientSlackId,
          this.getNotificationMessage(request, comments),
          approvedBy.slack_team_id,
        );
      }
    }
  }

  private getNotificationMessage(
    request: IVacationRequestViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ) {
    const name = escapeMrkdwn(request.user!.name);

    return {
      text: [
        `✅ Time off approved for *${name}*`,
        this.getRequestDetails(request),
        getApproverCommentLines(comments).join('\n'),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
}
