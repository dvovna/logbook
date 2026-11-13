import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import pluralize from 'pluralize';
import { reportError } from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import {
  formatDateRange,
  getDateOnly,
  weekLabel,
} from '@common/utils/date.utils';
import { getDisplayTime, sumMinutes } from '@common/utils/time.utils';
import {
  currentWeekStart,
  PeriodPreset,
  presetPeriod,
  weekStartOf,
} from '@common/utils/period-presets';
import { runPeriodically } from '@common/utils/periodic.utils';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import {
  dailyReminderDay,
  REMIND_FROM_HOUR_UTC,
  weeklyReminderGroups,
} from 'src/time-entries/utils/time-reminder-schedule';
import { TransactionService } from 'src/database/transaction.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { weeksOf } from '@modules/slack/tabs/time-tracking/utils/weeks-of.utils';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { OPEN_TIME_ENTRY_STATUSES } from 'src/time-entries/constants/open-time-entry-statuses';
import { TimeEntryStatus } from 'src/time-entries/enums/time-entry-status.enum';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';

export const REMIND_UNSUBMITTED_JOB = 'time-entries-remind-unsubmitted';

// So that the reminder goes out within 10 minutes of REMIND_FROM_HOUR_UTC;
// the week's claim keeps it to one a week.
const TICK_MS = 10 * 60 * 1000;
// Apart from the interval's first tick, TICK_MS after the start.
const FIRST_TICK_AFTER_MS = 5 * 60 * 1000;
// Each reminder is a DM of its own. Slack lets an app post a few hundred
// messages a minute in a workspace and answers 429 past that; at this rate
// 400 people are reminded in under two minutes.
const REMINDERS_PER_SECOND = 5;

interface IRemindJob {
  slackTeamId: string;
  userId: string;
  // The last day whose entries are reminded of.
  dateTo?: string;
  // The Monday of the reminder's week, all that a job saved before `dateTo`
  // existed carries: entries before it are reminded of.
  monday?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const dayBefore = (day: string) =>
  getDateOnly(new Date(new Date(`${day}T00:00:00Z`).getTime() - DAY_MS));

// The last day of the week before the one of `monday`.
const lastWeekEnd = (monday: string) =>
  presetPeriod(PeriodPreset.LastWeek, new Date(`${monday}T00:00:00Z`))!.toDate;

// Once a week, from Monday 09:00 UTC, reminds everyone who still has drafts
// or rejected entries from before that week: time reaches the approvers only
// once it is submitted. A workspace claims the week before it reminds
// (slack_teams.time_reminder_week), so a restart or the next tick sends
// nothing more, and a workspace whose app was down on Monday gets it at the
// next tick. Each person's message is a job: when Slack fails it is retried.
@Injectable()
export class TimeEntryRemindersService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(TimeEntryRemindersService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly timeEntriesService: TimeEntriesService,
    private readonly usersService: UsersService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly jobs: JobsService,
    private readonly transactions: TransactionService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IRemindJob>(REMIND_UNSUBMITTED_JOB, (job) =>
      this.sendReminder(job),
    );

    this.stopTimers = runPeriodically(() => this.remindAll(), {
      firstAfterMs: FIRST_TICK_AFTER_MS,
      everyMs: TICK_MS,
      logger: this.logger,
      failure: 'Could not remind of unsubmitted time',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // Every installed workspace, once a reminder is due: the week's, for the
  // people reminded every week (and once a month, in the month's first
  // week), and the day's, for the people reminded every working day.
  // Returns how many people it reminded.
  public async remindAll(now = new Date()): Promise<number> {
    const monday = currentWeekStart(now);
    const weekDueFrom = new Date(`${monday}T00:00:00Z`);

    weekDueFrom.setUTCHours(REMIND_FROM_HOUR_UTC);

    const weekDue = now >= weekDueFrom;
    const day = dailyReminderDay(now);

    if (!weekDue && !day) {
      return 0;
    }

    let reminded = 0;

    for (const slackTeamId of await this.slackTeamsService.findInstalledIds()) {
      // One workspace failing (e.g. a statement timeout) leaves its week or
      // day unclaimed for the next tick, and the others still get theirs.
      try {
        if (weekDue) {
          reminded += await this.remindWorkspace(slackTeamId, monday);
        }

        if (day) {
          reminded += await this.remindDaily(slackTeamId, day);
        }
      } catch (error) {
        this.logger.error(
          `Could not remind workspace ${slackTeamId} of unsubmitted time: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, { task: 'remind of unsubmitted time', slackTeamId });
      }
    }

    return reminded;
  }

  // Reminds the workspace's people of the week starting `monday`, unless
  // it did already. The week is claimed and the messages' jobs saved in one
  // transaction: a failure leaves neither, and the next tick tries again.
  // Returns how many people it reminds.
  public remindWorkspace(slackTeamId: string, monday: string): Promise<number> {
    return this.transactions.transaction(async () => {
      if (
        !(await this.slackTeamsService.claimReminderWeek(slackTeamId, monday))
      ) {
        return 0;
      }

      return this.remind(
        slackTeamId,
        lastWeekEnd(monday),
        weeklyReminderGroups(monday),
        monday,
      );
    });
  }

  // The same for the people reminded every working day, of what is open
  // from before `day`.
  public remindDaily(slackTeamId: string, day: string): Promise<number> {
    return this.transactions.transaction(async () => {
      if (!(await this.slackTeamsService.claimReminderDay(slackTeamId, day))) {
        return 0;
      }

      return this.remind(slackTeamId, dayBefore(day), [TimeReminder.Daily]);
    });
  }

  private async remind(
    slackTeamId: string,
    dateTo: string,
    reminders: TimeReminder[],
    monday?: string,
  ): Promise<number> {
    const userIds = await this.timeEntriesService.findUserIdsWithOpenUpTo({
      slackTeamId,
      dateTo,
      reminders,
    });

    await this.jobs.enqueueMany<IRemindJob>(
      REMIND_UNSUBMITTED_JOB,
      userIds.map((userId) => ({ slackTeamId, userId, dateTo, monday })),
      { perSecond: REMINDERS_PER_SECOND },
    );

    return userIds.length;
  }

  // What is still open when the job runs: nothing is sent once it is all
  // submitted, to someone deactivated, or to someone who turned the
  // reminder off since.
  private async sendReminder(job: IRemindJob) {
    const { slackTeamId, userId } = job;
    const dateTo = job.dateTo ?? (job.monday && lastWeekEnd(job.monday));

    if (!dateTo) {
      return;
    }

    const [user, entries] = await Promise.all([
      this.usersService.findOne({ id: userId, slackTeamId }),
      this.timeEntriesService.findMany({
        slackTeamId,
        userId,
        statuses: OPEN_TIME_ENTRY_STATUSES,
        dateTo,
      }),
    ]);

    if (!user || user.time_reminder === TimeReminder.Off || !entries.length) {
      return;
    }

    const dates = entries.map(({ work_date }) => work_date).sort();
    const minutes = sumMinutes(entries);
    const rejected = entries.filter(
      ({ status }) => status === TimeEntryStatus.Rejected,
    );

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      {
        text: [
          `:alarm_clock: You have *${pluralize('time entry', entries.length, true)}* (${getDisplayTime(minutes)}) from ${formatDateRange(dates[0], dates[dates.length - 1])} not submitted yet.`,
          rejected.length === 1 &&
            `1 of them was rejected: fix it under 🕒 My time (${weeksOf(rejected)}).`,
          rejected.length > 1 &&
            `${rejected.length} of them were rejected: fix them under 🕒 My time (${weeksOf(rejected)}).`,
          'Your approvers see time only once you submit it: Home → 📤 Submit for Approval.',
          'Change how often you are reminded: Home → 🔔 Reminders.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      slackTeamId,
    );
  }
}
