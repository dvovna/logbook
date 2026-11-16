import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { JobsService } from '@common/jobs/jobs.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { WorkflowStepStatus } from '@modules/request-workflows/types/request-workflow-step.interface';
import { currentRunOf } from '@modules/request-workflows/utils/workflow-runs';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { requestDetailsLine } from '@modules/slack/common/utils/view.utils';
import { VacationDecisionNotificationsService } from '@modules/slack/tabs/vacation-requests/services/vacation-decision-notifications.service';
import { TimeOffChangedEvent } from 'src/time-off-logging/events/time-off.events';
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
  // The requester's own logged time went: the DM telling of it (canceled,
  // the hours, billed days) is theirs, not a second one from here.
  requesterToldOfRemoval?: boolean;
}

interface ICanceledRecipientJob {
  requestId: string;
  slackTeamId: string;
  canceledBySlackId: string;
  recipientSlackId: string;
}

// Approved time off that is canceled (by its requester before it starts, or
// by HR or an admin with Edit Request) is told to whoever approved it and to
// the notification recipients of its team's rules, who heard of the
// approval, and to the requester when someone else canceled it. Whoever
// approved it: the approvers of its approved steps, and who decided them for
// them (HR's Approve for Approvers or Edit Request), as their messages say.
// One job per message, so a retry sends only the ones that failed.
@Injectable()
export class TimeOffCancelNoticesService implements OnModuleInit {
  public constructor(
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly decisionNotifications: VacationDecisionNotificationsService,
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
    removedTime,
  }: VacationRequestUpdatedEvent & Partial<TimeOffChangedEvent>) {
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
      requesterToldOfRemoval: !!removedTime?.owners.some(
        ({ userId }) => userId === request.user_id,
      ),
    });
  }

  // Saved before this job ends, so that a crash can't lose them with it.
  private async planNotices(job: ICanceledJob) {
    const request = await this.findCanceled(job);

    if (!request) {
      return;
    }

    const [steps, recipients, canceledBy] = await Promise.all([
      this.requestWorkflowStepsService.findMany({
        requestId: request.id,
        slackTeamId: job.slackTeamId,
      }),
      this.decisionNotifications.recipientsOf(request),
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
      .flatMap(({ slack_user_id, step_data }) => [
        slack_user_id,
        ...(step_data.decided_by_slack_id
          ? [step_data.decided_by_slack_id]
          : []),
      ]);
    const others = new Set([
      ...approvedBy,
      ...(job.requesterToldOfRemoval ? [] : [request.user!.slack_id]),
    ]);

    // Recipients are active already; someone else deactivated since hears
    // no more.
    const active = others.size
      ? await this.usersService.findMany({
          slackTeamId: job.slackTeamId,
          slackIds: [...others],
        })
      : [];
    const to = new Set([
      ...recipients,
      ...active.map(({ slack_id }) => slack_id),
    ]);

    to.delete(canceledBy.slack_id);

    await this.jobs.enqueueMany<ICanceledRecipientJob>(
      TIME_OFF_CANCELED_RECIPIENT_JOB,
      [...to].map((recipientSlackId) => ({
        requestId: job.requestId,
        slackTeamId: job.slackTeamId,
        canceledBySlackId: canceledBy.slack_id,
        recipientSlackId,
      })),
    );
  }

  private async notify({
    recipientSlackId,
    canceledBySlackId,
    ...job
  }: ICanceledRecipientJob) {
    const request = await this.findCanceled(job);

    if (request) {
      await this.communicationService.postMessage(
        recipientSlackId,
        { text: this.messageOf(request, canceledBySlackId) },
        job.slackTeamId,
      );
    }
  }

  // A retry after the request was deleted, or set to another status since,
  // tells nobody.
  private async findCanceled({
    requestId,
    slackTeamId,
  }: Pick<ICanceledJob, 'requestId' | 'slackTeamId'>) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    return request?.status === VacationRequestStatus.Canceled ? request : null;
  }

  private messageOf(request: IVacationRequestViewModel, canceledBy: string) {
    return [
      `🚫 Time off canceled for *${escapeMrkdwn(request.user!.name)}*`,
      requestDetailsLine(request),
      `Canceled by <@${canceledBy}>`,
    ].join('\n');
  }
}
