import { formatDate } from '@common/utils/date.utils';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDisplayTime } from '@common/utils/time.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { UsersService } from '@modules/users/services/users.service';

export const NOTIFY_REJECTED_JOB = 'time-entry-notify-rejected';

interface INotifyRejectedJob {
  timeEntryId: string;
  slackTeamId: string;
  reviewerId: string;
  // Not kept anywhere else.
  reason?: string;
}

@Injectable()
export class TimeEntryNotificationsService implements OnModuleInit {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly usersService: UsersService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<INotifyRejectedJob>(NOTIFY_REJECTED_JOB, (job) =>
      this.sendRejected(job),
    );
  }

  // Tells the owner which entry was rejected, by whom and why, and where to
  // fix it.
  // A job: when Slack fails the message is retried, not lost.
  public notifyRejected(
    entry: ITimeEntryViewModel,
    reviewer: IUserViewModel,
    reason?: string,
  ) {
    this.jobs.run<INotifyRejectedJob>(NOTIFY_REJECTED_JOB, {
      timeEntryId: entry.id,
      slackTeamId: reviewer.slack_team_id,
      reviewerId: reviewer.id,
      ...(reason ? { reason } : {}),
    });
  }

  private async sendRejected({
    timeEntryId,
    slackTeamId,
    reviewerId,
    reason,
  }: INotifyRejectedJob) {
    const [entry, reviewer] = await Promise.all([
      this.timeEntriesService.findOne({ id: timeEntryId, slackTeamId }),
      this.usersService.findOne({
        id: reviewerId,
        slackTeamId,
        includeInactive: true,
      }),
    ]);

    // Fixed or deleted before a retry: the message would be out of date.
    if (
      !entry?.user ||
      !reviewer ||
      entry.status !== TimeEntryStatus.Rejected
    ) {
      return;
    }

    const workDate = formatDate(entry.work_date);
    const project = escapeMrkdwn(entry.project?.name ?? 'a project');
    const client = entry.client ? ` (${escapeMrkdwn(entry.client.name)})` : '';
    const lines = [
      `:x: ${escapeMrkdwn(reviewer.name)} rejected your time entry: *${project}*${client}, ${workDate}, ${getDisplayTime(entry.minutes)}.`,
      ...(reason ? [`>${escapeMrkdwn(reason).replace(/\n/g, '\n>')}`] : []),
      'Fix it under Home → ✏️ Edit Entries and submit it again.',
    ];

    await this.slackCommunicationService.postMessage(
      entry.user.slack_id,
      { text: lines.join('\n') },
      reviewer.slack_team_id,
    );
  }
}
