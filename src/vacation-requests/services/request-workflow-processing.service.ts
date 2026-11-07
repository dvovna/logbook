import { Injectable, Logger } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { OnEvent } from '@nestjs/event-emitter';
import { VacationWorkflowEventEnum } from '@common/enums/vacation-workflow-event.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { UsersService } from '@modules/users/services/users.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import TeamsService from '@modules/teams/services/teams.service';
import { VacationWorkflowFinished } from '@common/events/vacation-workflow.events';
import { VACATION_TYPE_DISPLAY_NAME_MAP } from '@modules/slack/common/views/data/vacation-type-display-name';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import { getApproverCommentLines } from '@modules/slack/common/utils/view.utils';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import { ImageBlock } from '@slack/web-api';
import { SlackMessagePayloadInterface } from '@modules/slack-communication/types/slack-message-payload.interface';

@Injectable()
export class RequestWorkflowProcessingService {
  private readonly logger = new Logger(RequestWorkflowProcessingService.name);

  private readonly approvedGifs = [
    'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExYjdoMTdyOTNkbnNvbWwzY2Z3dW9iMnJkOXpyeXFpbzJqcDlkaXlxYSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/cXblnKXr2BQOaYnTni/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExbWsybXA5eG11MTNhNWVqZ25odnJyMmlwOTNueDlrMTZiZG12YWd2ZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mKklyHxxGDDa37zOuA/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaWJzdDFzOGg4bDBxY2p1ejl0cGJsczRnY3Q0YXB2ZGxob2d2M2NpYyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/CQwNV6b8ScIFvTSO6u/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExMTZxbjMzbXRiaWg5aXl0MmNwdXc4aWhuN3FuYnlkN2l5M2VobXVraCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Z8Lt37Ylt60bM9Iuwo/giphy.gif',
    'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExN3Y4ZWtmNHd0bGFyY3didDZoendvbzY4eDFlOHl0MzhxaXp6NzFydSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ktHuiYG7qYCOrJCqG0/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExZ2lrOXNsODl3dmk0M2ZkeTFma3JzYmxmbXdjOTJ6OGYwMGp2bnloeiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/GS9pfaxQj5hPKFGGp8/giphy.gif',
    'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExMmh0emc4dnZ6anY3MDZlb2k1aHdtamlnbHB0MG4xcnZ3Y25haHJ1ZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/uJFSCnoNb98RbxoJ4p/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExNG5lMDZwbGgzNmVmc2pkZjJoaDFra2lqdTIwa2E2cGN1bzl3eGd0dyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/G9dpMnCg4zRIEePql2/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWdtMjkyOW5qbGI1Zms0NHl6bHR3Z3loMzgzcGhnYnpwdGIzMHBheiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/sVnKj2wDhUTsFKFWhx/giphy.gif',
  ];

  private readonly approvedTexts = [
    '🌴 Your vacation vibes are strong today!',
    '🍹 Don’t forget to sip something cold under the sun!',
    '🧳 Adventure awaits! Pack light and smile 😎',
  ];

  private readonly rejectedGifs = [
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExOTRmMnllOXRza2d0M28zNGYwNWJ5cW5iYTBxM2Y0cDhzaXJwZ2N1YyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/WygEr1vMRXmzemxGmG/giphy.gif',
    'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExb210dGdmYTZuZmlyNTQ2dDU2N3NsMGhiN2NsN2l1aDJieHI4M3B1aSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Aw3fb0IdDPsR8lLJH8/giphy.gif',
    'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExdHl1N3lrN2hkYnJmdmx0dGFwZGE2em52emJ3YTdkNHFzYmpjeHZjYiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/eUu9zYuNqLBWk5OzRE/giphy.gif',
    'https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExbXltZXo5Z2J5N2hvczI1YWQ3NDFpbGR4ODFibHEyb3Q5cHltdDFudyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/jp7jSyjNNz2ansuOS8/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExdXgxcHExZDF1bHI2ajNjbW94dHpuc3E5ZGJkODQ0aGl0OWxtZWJtZiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/AYMzMAgZIci8IgezfQ/giphy.gif',
    'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYmpsNjJmMTQ2eGtwNGdiNXZ3YmhkNTA4ejd3cjNheTh4b2ZieXU1biZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/0VZk87fnXAdnwa5xl8/giphy.gif',
    'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExajl2MXJkMjE1c3U2N3hhOXRxbHhsMTBveWQwYXkydGFhenZ1eXJhdiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ljtfkyTD3PIUZaKWRi/giphy.gif',
  ];

  private readonly rejectedTexts = [
    '☕ Coffee break time! Don’t be sad, tomorrow is another chance!',
    '💪 Keep your spirits up! Your vacation will come!',
    '🐢 Slow and steady… your next vacation is on the horizon!',
  ];

  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly usersService: UsersService,
    private readonly teamsService: TeamsService,
    private readonly communicationService: SlackCommunicationService,
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
      await this.notifyOnApproval(
        updatedRequest,
        approvedBy,
        workflow.reviewComments,
      );
    }

    await this.notifyUser(updatedRequest, workflow.reviewComments);
  }

  private getUserNotificationMessage(
    request: IVacationRequestViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): SlackMessagePayloadInterface {
    if (request.status === VacationRequestStatus.Approved) {
      const randomGif =
        this.approvedGifs[Math.floor(Math.random() * this.approvedGifs.length)];

      const randomText =
        this.approvedTexts[
          Math.floor(Math.random() * this.approvedTexts.length)
        ];

      return {
        blocks: [
          {
            type: 'image',
            image_url: randomGif,
            alt_text: 'Vacation approved',
          } as ImageBlock,
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✅ Great news! Your vacation request has been approved 🎉

${this.getRequestDetails(request, comments)}
${randomText}`,
            },
          } as KnownBlock,
        ],
      };
    } else {
      const randomGif =
        this.rejectedGifs[Math.floor(Math.random() * this.rejectedGifs.length)];

      const randomText =
        this.rejectedTexts[
          Math.floor(Math.random() * this.rejectedTexts.length)
        ];

      return {
        blocks: [
          {
            type: 'image',
            image_url: randomGif,
            alt_text: 'Vacation rejected',
          } as ImageBlock,
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `❌ Bad news... Your vacation request has been rejected 💔

${this.getRequestDetails(request, comments)}
${randomText}`,
            },
          } as KnownBlock,
        ],
      };
    }
  }

  private async notifyUser(
    request: IVacationRequestViewModel,
    comments: IWorkflowStepCommentViewModel[] = [],
  ) {
    await this.communicationService.postMessage(
      request.user!.slack_id,
      this.getUserNotificationMessage(request, comments),
      request.slack_team_id,
    );
  }

  private getRequestDetails(
    request: IVacationRequestViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ) {
    return `
📅 ${request.start_date} → ${request.end_date} (${request.days} calendar days, ${request.working_days} working days)
🏖️ Type: ${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]}

${getApproverCommentLines(comments).join('\n')}
    `;
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
    return {
      text: `✅ Vacation request approved for ${escapeMrkdwn(request.user!.name)}:

📅 ${request.start_date} → ${request.end_date} (${request.days} calendar days, ${request.working_days} working days)
🏖️ Type: ${VACATION_TYPE_DISPLAY_NAME_MAP[request.type]}

${getApproverCommentLines(comments).join('\n')}`,
    };
  }
}
