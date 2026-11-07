import { Injectable } from '@nestjs/common';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDisplayTime } from '@common/utils/time.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

@Injectable()
export class TimeEntryNotificationsService {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
  ) {}

  // Tells the owner which entry was rejected, by whom and why, and where to
  // fix it.
  public async notifyRejected(
    entry: ITimeEntryViewModel,
    reviewer: IUserViewModel,
    reason?: string,
  ) {
    if (!entry.user) {
      return;
    }

    const workDate = new Date(entry.work_date).toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
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
