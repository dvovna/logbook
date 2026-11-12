import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { formatDateRange } from '@common/utils/date.utils';
import { JobsService } from '@common/jobs/jobs.service';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { VacationWorkflowEventEnum } from '@common/enums/vacation-workflow-event.enum';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  IApprovalFallback,
  VacationRequestSentForApprovalEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import {
  IColleagueOff,
  TimeOffContextService,
} from '@modules/vacation-requests/services/time-off-context.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { VacationWorkflowLevelCompleted } from '@modules/request-workflows/events/vacation-workflow.events';
import { currentRunOf } from '@modules/request-workflows/utils/workflow-runs';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import {
  escapeMrkdwn,
  quoteMrkdwn,
} from '@modules/slack/common/utils/mrkdwn.utils';
import { WorkflowStepCommentEvent } from '@modules/request-workflows/enums/workflow-step-comment-event.enum';
import { RequestWorkflowStepCommentAddedEvent } from '@modules/request-workflows/events/request-workflow-step-comment.events';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { RequesterNoticeActionId } from '@modules/slack/tabs/vacation-requests/enums/requester-notice-action-id.enum';

export const SENT_NOTICE_JOB = 'vacation-request-sent-notice';
export const LEVEL_NOTICE_JOB = 'vacation-request-level-notice';
export const COMMENT_NOTICE_JOB = 'vacation-request-comment-notice';

interface ISentNoticeJob {
  requestId: string;
  slackTeamId: string;
  fallback: IApprovalFallback | null;
}

interface ILevelNoticeJob {
  requestId: string;
  slackTeamId: string;
  level: number;
  // The level asked now; the one after `level` in jobs saved before.
  nextLevel?: number;
}

interface ICommentNoticeJob {
  commentId: string;
  slackTeamId: string;
}

// Keeps the requester posted while the request waits: who it went to (with
// who else on the team is off then), each level that approved it, and each
// approver's comment, with buttons to see the request or cancel it. The
// decision itself is VacationDecisionNotificationsService's. Each DM is a
// job, retried when Slack fails.
@Injectable()
export class VacationRequestProgressNoticesService implements OnModuleInit {
  public constructor(
    private readonly communicationService: SlackCommunicationService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly timeOffContextService: TimeOffContextService,
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<ISentNoticeJob>(SENT_NOTICE_JOB, (job) =>
      this.notifySent(job),
    );
    this.jobs.define<ILevelNoticeJob>(LEVEL_NOTICE_JOB, (job) =>
      this.notifyLevelCompleted(job),
    );
    this.jobs.define<ICommentNoticeJob>(COMMENT_NOTICE_JOB, (job) =>
      this.notifyCommented(job),
    );
  }

  // An approver who asks something waits for an answer, so the requester
  // hears of a comment when it is made, not only with the decision. Runs in
  // the comment's transaction (emitAsync), so the DM's job is saved with it.
  @OnEvent(WorkflowStepCommentEvent.Added, { suppressErrors: false })
  public async handleCommentAdded({
    comment,
  }: RequestWorkflowStepCommentAddedEvent) {
    await this.jobs.enqueue<ICommentNoticeJob>(COMMENT_NOTICE_JOB, {
      commentId: comment.id,
      slackTeamId: comment.slack_team_id,
    });
  }

  // Runs in the transaction that makes the workflow (emitAsync), so the DM's
  // job is saved with its steps.
  @OnEvent(VacationRequestEvent.SentForApproval, { suppressErrors: false })
  public async handleSentForApproval({
    request,
    fallback,
  }: VacationRequestSentForApprovalEvent) {
    await this.jobs.enqueue<ISentNoticeJob>(SENT_NOTICE_JOB, {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      fallback,
    });
  }

  // Runs inside the decision's transaction (emitAsync), so the DM's job is
  // saved with the decision.
  @OnEvent(VacationWorkflowEventEnum.LevelCompleted, { suppressErrors: false })
  public async handleLevelCompleted({
    requestId,
    slackTeamId,
    level,
    nextLevel,
  }: VacationWorkflowLevelCompleted) {
    await this.jobs.enqueue<ILevelNoticeJob>(LEVEL_NOTICE_JOB, {
      requestId,
      slackTeamId,
      level,
      nextLevel,
    });
  }

  private async notifySent({
    requestId,
    slackTeamId,
    fallback,
  }: ISentNoticeJob) {
    const request = await this.findWaiting(requestId, slackTeamId);

    if (!request) {
      return;
    }

    const sentTo = fallback
      ? this.getFallbackText(request, fallback)
      : await this.getSentToText(request);

    if (!sentTo) {
      return;
    }

    const colleaguesOff = await this.timeOffContextService.findColleaguesOff(
      request,
      { forRequester: true },
    );

    await this.post(
      request,
      [sentTo, this.getOverlapText(colleaguesOff)].filter(Boolean).join('\n'),
    );
  }

  private async notifyLevelCompleted({
    requestId,
    slackTeamId,
    level,
    nextLevel = level + 1,
  }: ILevelNoticeJob) {
    const request = await this.findWaiting(requestId, slackTeamId);

    if (!request) {
      return;
    }

    const steps = currentRunOf(
      await this.requestWorkflowStepsService.findMany({
        requestId,
        slackTeamId,
      }),
    );
    const completed = steps.filter(({ step_level }) => step_level === level);
    const next = steps.filter(({ step_level }) => step_level === nextLevel);
    const approvedBy = completed
      .filter(
        ({ step_data }) => step_data.status === WorkflowStepStatus.Approved,
      )
      .map(
        ({ step_data, slack_user_id }) =>
          step_data.decided_by_slack_id ?? slack_user_id,
      );

    // A level passed over because nobody on it could decide any more was
    // approved by no one: the next level's own DM is what the requester
    // needs, and the request's details show the rest.
    if (!approvedBy.length || !next.length) {
      return;
    }

    await this.post(
      request,
      `✅ Your vacation request (${this.datesOf(request)}): ${this.levelNameOf(completed)} done by ${this.mentions(approvedBy)}. Now waiting for ${this.levelNameOf(next)} from ${this.mentions(next.map(({ slack_user_id }) => slack_user_id))}.`,
    );
  }

  private async notifyCommented({ commentId, slackTeamId }: ICommentNoticeJob) {
    const comment = await this.requestWorkflowStepCommentsService.findOne({
      id: commentId,
      slackTeamId,
    });
    const request =
      comment && (await this.findWaiting(comment.request_id, slackTeamId));

    // Decided meanwhile: the decision's DM shows the comments.
    if (
      !comment ||
      !request ||
      comment.slack_user_id === request.user!.slack_id
    ) {
      return;
    }

    const dates = this.datesOf(request);
    const text = `💬 <@${comment.slack_user_id}> commented on your vacation request (${dates}):\n${quoteMrkdwn(comment.comment)}`;

    await this.communicationService.postMessage(
      request.user!.slack_id,
      {
        text: `💬 A comment on your vacation request (${dates})`,
        blocks: [
          { type: 'section', text: { type: 'mrkdwn', text } },
          {
            type: 'context',
            elements: [
              {
                type: 'mrkdwn',
                text: 'The request is still pending. To change its dates, cancel it and request new ones.',
              },
            ],
          },
          {
            type: 'actions',
            block_id: ViewCallbackId.RequesterNoticeMessage,
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: '📋 View Details' },
                action_id: RequesterNoticeActionId.ViewDetails,
                value: `${RequesterNoticeActionId.ViewDetails}:${request.id}`,
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: '❌ Cancel Request' },
                action_id: RequesterNoticeActionId.CancelRequest,
                value: `${RequesterNoticeActionId.CancelRequest}:${request.id}`,
              },
            ],
          },
        ],
      },
      request.slack_team_id,
    );
  }

  // Canceled, decided or deleted before the DM went out: nothing to tell.
  private async findWaiting(requestId: string, slackTeamId: string) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    return request?.user && request.status === VacationRequestStatus.Pending
      ? request
      : null;
  }

  private async getSentToText(request: IVacationRequestViewModel) {
    const firstLevel = currentRunOf(
      await this.requestWorkflowStepsService.findMany({
        requestId: request.id,
        slackTeamId: request.slack_team_id,
        stepLevel: 1,
      }),
    );

    if (!firstLevel.length) {
      return null;
    }

    const approvers = firstLevel.map(({ slack_user_id }) => slack_user_id);

    return `📨 Your vacation request (${this.datesOf(request)}) went to ${this.mentions(approvers)} (${this.levelNameOf(firstLevel)}).`;
  }

  private getFallbackText(
    request: IVacationRequestViewModel,
    { inTeam, followsCompanyRules, sentTo }: IApprovalFallback,
  ) {
    const dates = this.datesOf(request);
    const reason = !inTeam
      ? 'you are not in a team and the company rules name no other approvers'
      : followsCompanyRules
        ? 'neither your team nor the company rules name other approvers'
        : 'your team has no other approvers';

    if (sentTo === UserRole.HR) {
      return `📨 Your vacation request (${dates}) went to HR for approval: ${reason}.`;
    }

    if (sentTo === UserRole.Admin) {
      return `📨 Your vacation request (${dates}) went to the workspace admins for approval: ${reason}.`;
    }

    // A request keeps the team it was made in: what changes is who approves.
    const until = !inTeam
      ? 'an admin names approvers in the company rules or gives someone the HR or Admin role'
      : followsCompanyRules
        ? 'an admin names approvers for your team or in the company rules, or gives someone the HR or Admin role'
        : 'an admin adds approvers to your team or gives someone the HR or Admin role';

    return `⚠️ Nobody can approve your vacation request (${dates}) yet: ${reason}, and nobody else has the HR or Admin role. It goes for approval once ${until}.`;
  }

  private getOverlapText(colleaguesOff: IColleagueOff[]) {
    if (!colleaguesOff.length) {
      return null;
    }

    const names = colleaguesOff
      .map(
        ({ name, start_date, end_date }) =>
          `${escapeMrkdwn(name)} (${formatDateRange(start_date, end_date)})`,
      )
      .join(', ');

    return `⚠️ Also off on those days: ${names}. Your request may be rejected because of the overlap.`;
  }

  private post(request: IVacationRequestViewModel, text: string) {
    return this.communicationService.postMessage(
      request.user!.slack_id,
      { text },
      request.slack_team_id,
    );
  }

  private datesOf(request: IVacationRequestViewModel) {
    return formatDateRange(request.start_date, request.end_date);
  }

  // Workflows made before levels had names show the level's number.
  private levelNameOf([step]: IRequestWorkflowStepViewModel[]) {
    return step.step_data.level_name ?? `Level ${step.step_level}`;
  }

  private mentions(slackIds: string[]) {
    return [...new Set(slackIds)].map((id) => `<@${id}>`).join(', ');
  }
}
