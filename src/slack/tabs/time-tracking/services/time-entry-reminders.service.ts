import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import pluralize from 'pluralize';
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

const TICK_MS = 60 * 60 * 1000;
const FIRST_TICK_AFTER_MS = 10 * 60 * 1000;
// Reminders go out from this hour on Monday, UTC.
const REMIND_FROM_HOUR_UTC = 9;
interface IRemindJob {
  slackTeamId: string;
  userId: string;
  // The Monday of the reminder's week: entries before it are reminded of.
  monday: string;
}

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

  // Every installed workspace, once the week's reminder is due. Returns how
  // many people it reminded.
  public async remindAll(now = new Date()): Promise<number> {
    const monday = currentWeekStart(now);
    const dueFrom = new Date(`${monday}T00:00:00Z`);

    dueFrom.setUTCHours(REMIND_FROM_HOUR_UTC);

    if (now < dueFrom) {
      return 0;
    }

    let reminded = 0;

    for (const slackTeamId of await this.slackTeamsService.findInstalledIds()) {
      reminded += await this.remindWorkspace(slackTeamId, monday);
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

      const entries = await this.timeEntriesService.findMany({
        slackTeamId,
        statuses: OPEN_TIME_ENTRY_STATUSES,
        dateTo: lastWeekEnd(monday),
      });
      const userIds = [...new Set(entries.map(({ user_id }) => user_id))];

      for (const userId of userIds) {
        await this.jobs.enqueue<IRemindJob>(REMIND_UNSUBMITTED_JOB, {
          slackTeamId,
          userId,
          monday,
        });
      }

      return userIds.length;
    });
  }

  // What is still open when the job runs: nothing is sent once it is all
  // submitted, or to someone deactivated.
  private async sendReminder({ slackTeamId, userId, monday }: IRemindJob) {
    const [user, entries] = await Promise.all([
      this.usersService.findOne({ id: userId, slackTeamId }),
      this.timeEntriesService.findMany({
        slackTeamId,
        userId,
        statuses: OPEN_TIME_ENTRY_STATUSES,
        dateTo: lastWeekEnd(monday),
      }),
    ]);

    if (!user || !entries.length) {
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
            `1 of them was rejected: fix it under Home → ✏️ Edit Entries (${weeksOf(rejected)}).`,
          rejected.length > 1 &&
            `${rejected.length} of them were rejected: fix them under Home → ✏️ Edit Entries (${weeksOf(rejected)}).`,
          'Your approvers see time only once you submit it: Home → 📤 Submit for Approval.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      slackTeamId,
    );
  }
}
