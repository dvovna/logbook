import { OnEvent } from '@nestjs/event-emitter';
import { groupBy } from 'lodash';
import pluralize from 'pluralize';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import {
  TIME_ENTRIES_SUBMITTED,
  TimeEntriesSubmittedEvent,
} from 'src/time-entries/events/time-entries.events';
import {
  ABSENCE_DAY_CHECKED,
  AbsenceDayCheckedEvent,
} from '@modules/request-workflows/events/absence.events';
import { onTimeOffTextOf } from '@modules/slack/common/utils/time-off-text';
import { formatDate, getDateOnly, weekLabel } from '@common/utils/date.utils';
import { weekStartOf } from '@common/utils/period-presets';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import {
  escapeMrkdwn,
  quoteMrkdwn,
} from '@modules/slack/common/utils/mrkdwn.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { getDisplayTime, sumMinutes } from '@common/utils/time.utils';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { UsersService } from '@modules/users/services/users.service';

export const NOTIFY_REJECTED_JOB = 'time-entry-notify-rejected';
export const NOTIFY_SUBMITTED_JOB = 'time-entries-notify-submitted';
export const NOTIFY_MOVED_JOB = 'time-entries-notify-moved';
export const PLAN_MOVED_JOB = 'time-entries-plan-moved';

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

interface IPlanMovedJob {
  slackTeamId: string;
  date: string;
}

interface INotifyMovedJob {
  slackTeamId: string;
  approverId: string;
  // Worked out by the plan: a retry sends what the plan saw.
  text: string;
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
    this.jobs.define<IPlanMovedJob>(PLAN_MOVED_JOB, (job) =>
      this.planMoved(job),
    );
    this.jobs.define<INotifyMovedJob>(NOTIFY_MOVED_JOB, (job) =>
      this.sendMoved(job),
    );
  }

  // The daily check ran: whoever now gets entries because every manager
  // listed for them is on time off from today hears of it once. Runs in the
  // claim's transaction (emitAsync), which holds the workspace's row: it only
  // saves the plan, and the claim makes it one per workspace and day.
  @OnEvent(ABSENCE_DAY_CHECKED, { suppressErrors: false })
  public async handleAbsenceDayChecked({
    slackTeamId,
    date,
  }: AbsenceDayCheckedEvent) {
    await this.jobs.enqueue<IPlanMovedJob>(PLAN_MOVED_JOB, {
      slackTeamId,
      date,
    });
  }

  // Tells each approver of the submitted entries, in one message, what waits
  // for them (TimeEntryApprovalsService.groupByApprover). A job per
  // approver: when Slack fails the message is retried, not lost. Runs in the
  // transaction that submits them (emitAsync), so the jobs are saved, in one
  // statement, with the entries' status.
  @OnEvent(TIME_ENTRIES_SUBMITTED, { suppressErrors: false })
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
    const jobs = groups
      .filter(({ approver }) => approver.id !== submittedById)
      .flatMap(({ approver, entries: theirs }) =>
        // One message per owner: Admin or HR may log time for several people.
        Object.entries(groupBy(theirs, ({ user_id }) => user_id)).map(
          ([ownerId, owned]): INotifySubmittedJob => ({
            slackTeamId,
            approverId: approver.id,
            ownerId,
            entryIds: owned.map(({ id }) => id),
          }),
        ),
      );

    await this.jobs.enqueueMany<INotifySubmittedJob>(
      NOTIFY_SUBMITTED_JOB,
      jobs,
    );
  }

  // Tells the owner which entry was rejected, by whom and why, and where to
  // fix it: My time shows a week, so the message names the entry's.
  // A job: when Slack fails the message is retried, not lost. Call it in the
  // transaction that rejects the entry, which saves the job.
  public notifyRejected(
    entry: ITimeEntryViewModel,
    reviewer: IUserViewModel,
    reason?: string,
  ) {
    return this.jobs.enqueue<INotifyRejectedJob>(NOTIFY_REJECTED_JOB, {
      timeEntryId: entry.id,
      slackTeamId: reviewer.slack_team_id,
      reviewerId: reviewer.id,
      ...(reason ? { reason } : {}),
    });
  }

  // Works out who now gets which entries, once, and saves each of them a
  // DM job with its text, in one statement: a failure before it is retried
  // as a whole, and after it the plan is done.
  private async planMoved({ slackTeamId, date }: IPlanMovedJob) {
    const moved = await this.timeEntryApprovalsService.findMovedByAbsence(
      slackTeamId,
      date,
    );

    await this.jobs.enqueueMany<INotifyMovedJob>(
      NOTIFY_MOVED_JOB,
      moved.map(({ approver, groups }) => ({
        slackTeamId,
        approverId: approver.id,
        text: groups
          .map(({ teamName, away, count }) => {
            const team = teamName
              ? escapeMrkdwn(teamName)
              : 'people in no team';

            return `${onTimeOffTextOf(away)}: ${count} time ${pluralize('entry', count)} of ${team} now ${count === 1 ? 'waits' : 'wait'} for you in Approvals.`;
          })
          .join('\n'),
      })),
    );
  }

  private async sendMoved({ slackTeamId, approverId, text }: INotifyMovedJob) {
    const approver = await this.usersService.findOne({
      id: approverId,
      slackTeamId,
    });

    if (!approver) {
      return;
    }

    await this.slackCommunicationService.postMessage(
      approver.slack_id,
      { text },
      slackTeamId,
    );
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
      ...(reason ? [quoteMrkdwn(reason)] : []),
      `Fix it under 🕒 My time (week of ${week}) and submit it again.`,
    ];

    await this.slackCommunicationService.postMessage(
      entry.user.slack_id,
      { text: lines.join('\n') },
      reviewer.slack_team_id,
    );
  }
}
