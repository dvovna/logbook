import { OnEvent } from '@nestjs/event-emitter';
import { groupBy } from 'lodash';
import pluralize from 'pluralize';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import {
  TIME_ENTRIES_SUBMITTED,
  TimeEntriesSubmittedEvent,
} from 'src/time-entries/events/time-entries.events';
import { formatDate, getDateOnly } from '@common/utils/date.utils';
import { weekStartOf } from '@common/utils/period-presets';
import { weekLabel } from '@modules/slack/tabs/time-tracking/views/timesheet-table.view';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDisplayTime, sumMinutes } from '@common/utils/time.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { UsersService } from '@modules/users/services/users.service';

export const NOTIFY_REJECTED_JOB = 'time-entry-notify-rejected';
export const NOTIFY_SUBMITTED_JOB = 'time-entries-notify-submitted';

// The projects a message names before "and N more".
const PROJECTS_NAMED = 3;

interface INotifyRejectedJob {
  timeEntryId: string;
  slackTeamId: string;
  reviewerId: string;
  // Not kept anywhere else.
  reason?: string;
}

interface INotifySubmittedJob {
  slackTeamId: string;
  approverId: string;
  ownerId: string;
  entryIds: string[];
}

@Injectable()
export class TimeEntryNotificationsService implements OnModuleInit {
  public constructor(
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly usersService: UsersService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<INotifyRejectedJob>(NOTIFY_REJECTED_JOB, (job) =>
      this.sendRejected(job),
    );
    this.jobs.define<INotifySubmittedJob>(NOTIFY_SUBMITTED_JOB, (job) =>
      this.sendSubmitted(job),
    );
  }

  // Tells each approver of the submitted entries, in one message, what waits
  // for them (TimeEntryApprovalsService.groupByApprover). A job per
  // approver: when Slack fails the message is retried, not lost.
  @OnEvent(TIME_ENTRIES_SUBMITTED)
  public async handleSubmitted({
    entries,
    slackTeamId,
    submittedById,
  }: TimeEntriesSubmittedEvent) {
    const groups = await this.timeEntryApprovalsService.groupByApprover(
      entries,
      slackTeamId,
    );

    // Admin or HR who logged it as submitted knows already.
    for (const { approver, entries: theirs } of groups.filter(
      ({ approver }) => approver.id !== submittedById,
    )) {
      // One message per owner: Admin or HR may log time for several people.
      for (const [ownerId, owned] of Object.entries(
        groupBy(theirs, ({ user_id }) => user_id),
      )) {
        void this.jobs.run<INotifySubmittedJob>(NOTIFY_SUBMITTED_JOB, {
          slackTeamId,
          approverId: approver.id,
          ownerId,
          entryIds: owned.map(({ id }) => id),
        });
      }
    }
  }

  // Tells the owner which entry was rejected, by whom and why, and where to
  // fix it: My time shows a week, so the message names the entry's.
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

  private async sendSubmitted({
    slackTeamId,
    approverId,
    ownerId,
    entryIds,
  }: INotifySubmittedJob) {
    const [entries, approver, owner] = await Promise.all([
      this.timeEntriesService.findMany({ ids: entryIds, slackTeamId }),
      this.usersService.findOne({ id: approverId, slackTeamId }),
      this.usersService.findOne({
        id: ownerId,
        slackTeamId,
        includeInactive: true,
      }),
    ]);
    // Decided, changed or deleted before a retry: only what still waits.
    const waiting = entries.filter(
      ({ status }) => status === TimeEntryStatus.Submitted,
    );

    if (!waiting.length || !approver || !owner) {
      return;
    }

    const byProject = Object.entries(
      groupBy(waiting, (entry) => entry.project?.name ?? 'No project'),
    ).sort(([, a], [, b]) => sumMinutes(b) - sumMinutes(a));
    const projects = byProject
      .slice(0, PROJECTS_NAMED)
      .map(
        ([name, list]) =>
          `${escapeMrkdwn(name)} (${getDisplayTime(sumMinutes(list))})`,
      );
    const more =
      byProject.length > PROJECTS_NAMED
        ? ` and ${pluralize('more project', byProject.length - PROJECTS_NAMED, true)}`
        : '';

    await this.slackCommunicationService.postMessage(
      approver.slack_id,
      {
        text: [
          `:inbox_tray: *${escapeMrkdwn(personLabel(owner))}* submitted *${pluralize('time entry', waiting.length, true)}* (${getDisplayTime(sumMinutes(waiting))}) for your approval: ${projects.join(', ')}${more}.`,
          'They wait for you in Logbook → ✅ Approvals.',
        ].join('\n'),
      },
      slackTeamId,
    );
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
    const week = weekLabel(weekStartOf(getDateOnly(entry.work_date)));
    const project = escapeMrkdwn(entry.project?.name ?? 'a project');
    const client = entry.client ? ` (${escapeMrkdwn(entry.client.name)})` : '';
    const lines = [
      `:x: ${escapeMrkdwn(reviewer.name)} rejected your time entry: *${project}*${client}, ${workDate}, ${getDisplayTime(entry.minutes)}.`,
      ...(reason ? [`>${escapeMrkdwn(reason).replace(/\n/g, '\n>')}`] : []),
      `Fix it under Home → ✏️ Edit Entries (week of ${week}) and submit it again.`,
    ];

    await this.slackCommunicationService.postMessage(
      entry.user.slack_id,
      { text: lines.join('\n') },
      reviewer.slack_team_id,
    );
  }
}
