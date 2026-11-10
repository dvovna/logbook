import { VACATION_TYPE_LABELS } from '@modules/slack/common/views/data/labels';
import { formatDateRange } from '@common/utils/date.utils';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { OnEvent } from '@nestjs/event-emitter';
import { KnownBlock } from '@slack/types/dist/block-kit/blocks';
import * as pluralize from 'pluralize';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { getApproverCommentLines } from '@modules/slack/common/utils/view.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackMessagePayloadInterface } from '@modules/slack-communication/types/slack-message-payload.interface';
import TeamsService from '@modules/teams/services/teams.service';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestDecidedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { UsersService } from '@modules/users/services/users.service';

export enum DecisionNotificationJob {
  Requester = 'vacation-decision-notify-requester',
  Recipients = 'vacation-decision-notify-recipients',
  Recipient = 'vacation-decision-notify-recipient',
}

interface IRequestJob {
  requestId: string;
  slackTeamId: string;
  decidedById: string;
}

interface IRecipientJob extends IRequestJob {
  recipientSlackId: string;
}

// The approver's words as a quote, safe to put in mrkdwn.
const quote = (text: string) => `>${escapeMrkdwn(text).replace(/\n/g, '\n>')}`;

// Tells the requester how their request was decided and, when it was approved,
// the team's approval_notification_recipients. One job per message, so a
// retry sends only the messages that failed.
@Injectable()
export class VacationDecisionNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(
    VacationDecisionNotificationsService.name,
  );

  public constructor(
    private readonly teamsService: TeamsService,
    private readonly communicationService: SlackCommunicationService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
    private readonly usersService: UsersService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IRequestJob>(DecisionNotificationJob.Requester, (job) =>
      this.notifyRequester(job),
    );
    this.jobs.define<IRequestJob>(DecisionNotificationJob.Recipients, (job) =>
      this.notifyRecipients(job),
    );
    this.jobs.define<IRecipientJob>(DecisionNotificationJob.Recipient, (job) =>
      this.notifyRecipient(job),
    );
  }

  @OnEvent(VacationRequestEvent.Decided)
  public handleDecided({ request, decidedBy }: VacationRequestDecidedEvent) {
    const job: IRequestJob = {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      decidedById: decidedBy.id,
    };

    this.jobs.run<IRequestJob>(DecisionNotificationJob.Requester, job);

    if (request.status === VacationRequestStatus.Approved) {
      this.jobs.run<IRequestJob>(DecisionNotificationJob.Recipients, job);
    }
  }

  private async notifyRequester(job: IRequestJob) {
    const decided = await this.loadDecided(job);

    if (!decided) {
      return;
    }

    const decidedBy = await this.usersService.findOneWithValidation({
      id: job.decidedById,
      slackTeamId: job.slackTeamId,
      includeInactive: true,
    });

    await this.notifyUser(decided.request, decidedBy, decided.comments);
  }

  private async notifyRecipients(job: IRequestJob) {
    const decided = await this.loadDecided(job);

    if (decided) {
      for (const recipientSlackId of await this.recipientsOf(decided.request)) {
        this.jobs.run<IRecipientJob>(DecisionNotificationJob.Recipient, {
          ...job,
          recipientSlackId,
        });
      }
    }
  }

  private async notifyRecipient({ recipientSlackId, ...job }: IRecipientJob) {
    const decided = await this.loadDecided(job);

    if (decided) {
      await this.communicationService.postMessage(
        recipientSlackId,
        this.getNotificationMessage(decided.request, decided.comments),
        job.slackTeamId,
      );
    }
  }

  // The request as it is when the job runs: a retry after the request was
  // canceled tells nobody anything.
  private async loadDecided({ requestId, slackTeamId }: IRequestJob) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    if (
      request?.status !== VacationRequestStatus.Approved &&
      request?.status !== VacationRequestStatus.Rejected
    ) {
      return null;
    }

    const comments = await this.requestWorkflowStepCommentsService.findMany({
      requestId,
      slackTeamId,
    });

    return { request, comments };
  }

  // What was decided and by whom, in plain words: the same message for every
  // workspace, whatever its mood.
  private getUserNotificationMessage(
    request: IVacationRequestViewModel,
    decidedBy: IUserViewModel,
    comments: IWorkflowStepCommentViewModel[],
  ): SlackMessagePayloadInterface {
    const approved = request.status === VacationRequestStatus.Approved;
    const type = VACATION_TYPE_LABELS[request.type].label;
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
              ...(!approved && request.rejection_reason
                ? [quote(request.rejection_reason)]
                : []),
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

  // '*Annual leave* · 6–10 Jul 2026 (5 days, 5 working)'
  private getRequestDetails(request: IVacationRequestViewModel) {
    return `*${VACATION_TYPE_LABELS[request.type].label}* · ${formatDateRange(request.start_date, request.end_date)} (${pluralize('day', request.days, true)}, ${request.working_days} working)`;
  }

  private async recipientsOf(request: IVacationRequestViewModel) {
    if (!request.team_id) {
      this.logger.warn(
        `Request ${request.id} has no team_id. Skipping approval notification.`,
      );

      return [];
    }

    const team = await this.teamsService.findOneWithValidation({
      id: request.team_id,
      slackTeamId: request.slack_team_id,
    });

    return team.approval_notification_recipients ?? [];
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
