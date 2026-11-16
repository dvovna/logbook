import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import pluralize from 'pluralize';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { JobsService } from '@common/jobs/jobs.service';
import { formatDateRange } from '@common/utils/date.utils';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { WorkflowStepStatus } from '@modules/request-workflows/types/request-workflow-step.interface';
import { currentRunOf } from '@modules/request-workflows/utils/workflow-runs';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { vacationTypeLabel } from '@modules/slack/common/views/data/labels';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { UsersService } from '@modules/users/services/users.service';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestUpdatedEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

export const TIME_OFF_CANCELED_JOB = 'time-off-canceled-notify';
export const TIME_OFF_CANCELED_RECIPIENT_JOB =
  'time-off-canceled-notify-recipient';

interface ICanceledJob {
  requestId: string;
  slackTeamId: string;
  canceledById: string;
}

interface ICanceledRecipientJob extends ICanceledJob {
  recipientSlackId: string;
}

// Approved time off that is canceled (by its requester before it starts, or
// by HR or an admin with Edit Request) is told to whoever approved it and to
// the notification recipients of its team's rules, who heard of the
// approval, and to the requester when someone else canceled it. One job per
// message, so a retry sends only the ones that failed.
@Injectable()
export class TimeOffCancelNoticesService implements OnModuleInit {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly teamRulesService: TeamRulesService,
    private readonly usersService: UsersService,
    private readonly communicationService: SlackCommunicationService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<ICanceledJob>(TIME_OFF_CANCELED_JOB, (job) =>
      this.planNotices(job),
    );
    this.jobs.define<ICanceledRecipientJob>(
      TIME_OFF_CANCELED_RECIPIENT_JOB,
      (job) => this.notify(job),
    );
  }

  // In the cancel's transaction (emitAsync), so the job is saved with it.
  // `previous` is the request as the change found it under the lock.
  @OnEvent(VacationRequestEvent.Updated, { suppressErrors: false })
  public async handleUpdated({
    request,
    previous,
    user,
  }: VacationRequestUpdatedEvent) {
    if (
      previous?.status !== VacationRequestStatus.Approved ||
      request.status !== VacationRequestStatus.Canceled
    ) {
      return;
    }

    await this.jobs.enqueue<ICanceledJob>(TIME_OFF_CANCELED_JOB, {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      canceledById: user.id,
    });
  }

  // Saved before this job ends, so that a crash can't lose them with it.
  private async planNotices(job: ICanceledJob) {
    const request = await this.findCanceled(job);

    if (!request) {
      return;
    }

    const [steps, rules, canceledBy] = await Promise.all([
      this.requestWorkflowStepsService.findMany({
        requestId: request.id,
        slackTeamId: job.slackTeamId,
      }),
      this.teamRulesService.forTeam(request.team_id, job.slackTeamId),
      this.usersService.findOneWithValidation({
        id: job.canceledById,
        slackTeamId: job.slackTeamId,
        includeInactive: true,
      }),
    ]);
    const approvedBy = currentRunOf(steps)
      .filter(
        ({ step_data }) => step_data.status === WorkflowStepStatus.Approved,
      )
      .map(
        ({ slack_user_id, step_data }) =>
          step_data.decided_by_slack_id ?? slack_user_id,
      );
    const candidates = new Set([
      ...approvedBy,
      ...rules.notificationRecipients,
      request.user!.slack_id,
    ]);

    candidates.delete(canceledBy.slack_id);

    // Someone deactivated since hears no more.
    const active = await this.usersService.findMany({
      slackTeamId: job.slackTeamId,
      slackIds: [...candidates],
    });

    await this.jobs.enqueueMany<ICanceledRecipientJob>(
      TIME_OFF_CANCELED_RECIPIENT_JOB,
      active.map(({ slack_id }) => ({ ...job, recipientSlackId: slack_id })),
    );
  }

  private async notify({ recipientSlackId, ...job }: ICanceledRecipientJob) {
    const request = await this.findCanceled(job);

    if (!request) {
      return;
    }

    const canceledBy = await this.usersService.findOneWithValidation({
      id: job.canceledById,
      slackTeamId: job.slackTeamId,
      includeInactive: true,
    });

    await this.communicationService.postMessage(
      recipientSlackId,
      { text: this.messageOf(request, canceledBy.slack_id) },
      job.slackTeamId,
    );
  }

  // A retry after the request was deleted, or set to another status since,
  // tells nobody.
  private async findCanceled({ requestId, slackTeamId }: ICanceledJob) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    return request?.status === VacationRequestStatus.Canceled ? request : null;
  }

  private messageOf(request: IVacationRequestViewModel, canceledBy: string) {
    return [
      `🚫 Time off canceled for *${escapeMrkdwn(request.user!.name)}*`,
      `*${vacationTypeLabel(request.type)}* · ${formatDateRange(request.start_date, request.end_date)} (${pluralize('day', request.days, true)}, ${request.working_days} working)`,
      `Canceled by <@${canceledBy}>`,
    ].join('\n');
  }
}
