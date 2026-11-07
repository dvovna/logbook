import { formatDateRange } from '@common/utils/date.utils';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JobsService } from '@common/jobs/jobs.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import UserRole from '@common/enums/user-role.enum';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestWithoutTeamApproversEvent } from '@modules/vacation-requests/events/vacation-request.events';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';

export const APPROVERS_NOTICE_JOB = 'vacation-request-approvers-notice';

interface IApproversNoticeJob {
  requestId: string;
  slackTeamId: string;
  inTeam: boolean;
  sentTo: VacationRequestWithoutTeamApproversEvent['sentTo'];
}

// Tells the requester who decides a request nobody on their team can approve:
// HR, the admins, or nobody yet. The DM is a job, retried when Slack fails.
@Injectable()
export class VacationApproversNoticeService implements OnModuleInit {
  public constructor(
    private readonly communicationService: SlackCommunicationService,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IApproversNoticeJob>(APPROVERS_NOTICE_JOB, (job) =>
      this.notify(job),
    );
  }

  @OnEvent(VacationRequestEvent.WithoutTeamApprovers)
  public handleWithoutTeamApprovers({
    request,
    inTeam,
    sentTo,
  }: VacationRequestWithoutTeamApproversEvent) {
    void this.jobs.run<IApproversNoticeJob>(APPROVERS_NOTICE_JOB, {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      inTeam,
      sentTo,
    });
  }

  private async notify({
    requestId,
    slackTeamId,
    inTeam,
    sentTo,
  }: IApproversNoticeJob) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    // Deleted before the DM went out.
    if (!request?.user) {
      return;
    }

    await this.communicationService.postMessage(
      request.user.slack_id,
      { text: this.getText(request, inTeam, sentTo) },
      request.slack_team_id,
    );
  }

  private getText(
    request: IVacationRequestViewModel,
    inTeam: boolean,
    sentTo: IApproversNoticeJob['sentTo'],
  ) {
    const dates = formatDateRange(request.start_date, request.end_date);
    const reason = inTeam
      ? 'your team has no other approvers'
      : 'you are not in a team';

    if (sentTo === UserRole.HR) {
      return `📨 Your vacation request (${dates}) went to HR for approval: ${reason}.`;
    }

    if (sentTo === UserRole.Admin) {
      return `📨 Your vacation request (${dates}) went to the workspace admins for approval: ${reason}.`;
    }

    return `⚠️ Nobody can approve your vacation request (${dates}) yet: ${reason}, and nobody else has the HR or Admin role. It stays pending until an admin adds approvers to your team.`;
  }
}
