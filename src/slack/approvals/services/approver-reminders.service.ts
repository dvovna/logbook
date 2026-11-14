import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import pluralize from 'pluralize';
import { reportError } from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { formatDate } from '@common/utils/date.utils';
import { currentWeekStart } from '@common/utils/period-presets';
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
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';

export const REMIND_APPROVER_JOB = 'approvals-remind-approver';

// What waited less is left out: its approver got a DM when it came, and
// may simply not have got to it yet.
export const APPROVER_REMINDER_AFTER_DAYS = 2;

const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_AFTER_MS = 5 * 60 * 1000;
const REMINDERS_PER_SECOND = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

interface IRemindApproverJob {
  slackTeamId: string;
  userId: string;
  // ISO timestamp: what has waited since before it is reminded of.
  waitedBefore: string;
}

// Reminds approvers of the time off steps and submitted time entries that
// have waited for their decision for APPROVER_REMINDER_AFTER_DAYS or more,
// in one DM, as often as each chose in Home → 🔔 Reminders (the choice that
// also sets the reminder of their own unsubmitted time), from 09:00 UTC.
// What waits for whom is the Approvals count's rule. A workspace claims the
// week or the day (slack_teams.approver_reminder_week/day) in the
// transaction that saves the messages' jobs, as TimeEntryRemindersService
// does, so a restart or a second process sends nothing more.
@Injectable()
export class ApproverRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApproverRemindersService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly usersService: UsersService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly timeEntryApprovalsService: TimeEntryApprovalsService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly jobs: JobsService,
    private readonly transactions: TransactionService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IRemindApproverJob>(REMIND_APPROVER_JOB, (job) =>
      this.sendReminder(job),
    );

    this.stopTimers = runPeriodically(() => this.remindAll(), {
      firstAfterMs: FIRST_TICK_AFTER_MS,
      everyMs: TICK_MS,
      logger: this.logger,
      failure: 'Could not remind approvers',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // Every installed workspace, once a reminder is due. Returns how many
  // approvers it reminds.
  public async remindAll(now = new Date()): Promise<number> {
    const monday = currentWeekStart(now);
    const weekDueFrom = new Date(`${monday}T00:00:00Z`);

    weekDueFrom.setUTCHours(REMIND_FROM_HOUR_UTC);

    const weekDue = now >= weekDueFrom;
    const day = dailyReminderDay(now);

    if (!weekDue && !day) {
      return 0;
    }

    const waitedBefore = new Date(
      now.getTime() - APPROVER_REMINDER_AFTER_DAYS * DAY_MS,
    );
    let reminded = 0;

    for (const slackTeamId of await this.slackTeamsService.findInstalledIds()) {
      // One workspace failing leaves its week or day unclaimed for the next
      // tick, and the others still get theirs.
      try {
        if (weekDue) {
          reminded += await this.remindWorkspace(
            slackTeamId,
            () =>
              this.slackTeamsService.claimApproverReminderWeek(
                slackTeamId,
                monday,
              ),
            weeklyReminderGroups(monday),
            waitedBefore,
          );
        }

        if (day) {
          reminded += await this.remindWorkspace(
            slackTeamId,
            () =>
              this.slackTeamsService.claimApproverReminderDay(slackTeamId, day),
            [TimeReminder.Daily],
            waitedBefore,
          );
        }
      } catch (error) {
        this.logger.error(
          `Could not remind approvers of workspace ${slackTeamId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, { task: 'remind approvers', slackTeamId });
      }
    }

    return reminded;
  }

  private remindWorkspace(
    slackTeamId: string,
    claim: () => Promise<boolean>,
    reminders: TimeReminder[],
    waitedBefore: Date,
  ): Promise<number> {
    return this.transactions.transaction(async () => {
      if (!(await claim())) {
        return 0;
      }

      const ids =
        await this.timeEntryApprovalsService.findApproversWaitingSince(
          slackTeamId,
          waitedBefore,
        );
      const slackIds =
        await this.requestWorkflowStepsService.findApproversWaitingSince(
          slackTeamId,
          waitedBefore,
        );
      const approvers = await this.usersService.findActiveWithReminder(
        slackTeamId,
        { ids, slackIds },
        reminders,
      );

      await this.jobs.enqueueMany<IRemindApproverJob>(
        REMIND_APPROVER_JOB,
        approvers.map(({ id }) => ({
          slackTeamId,
          userId: id,
          waitedBefore: waitedBefore.toISOString(),
        })),
        { perSecond: REMINDERS_PER_SECOND },
      );

      return approvers.length;
    });
  }

  // What still waits when the job runs: nothing is sent once it was all
  // decided, to someone deactivated, or to someone who turned reminders
  // off since.
  private async sendReminder({
    slackTeamId,
    userId,
    waitedBefore,
  }: IRemindApproverJob) {
    const user = await this.usersService.findOne({ id: userId, slackTeamId });

    if (!user?.is_active || user.time_reminder === TimeReminder.Off) {
      return;
    }

    const before = new Date(waitedBefore);
    const [timeOff, timeEntries] = await Promise.all([
      this.requestWorkflowStepsService.summarizeWaitingSince(user, before),
      this.timeEntryApprovalsService.summarizeWaitingSince(user, before),
    ]);

    if (!timeOff.count && !timeEntries.count) {
      return;
    }

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      {
        text: [
          ':hourglass_flowing_sand: Still waiting for your decision:',
          timeOff.count > 0 &&
            `• ${pluralize('time off request', timeOff.count, true)}, the oldest since ${formatDate(timeOff.oldest!)}`,
          timeEntries.count > 0 &&
            `• ${pluralize('time entry', timeEntries.count, true)} of ${pluralize('person', timeEntries.people, true)}, the oldest since ${formatDate(timeEntries.oldest!)}`,
          "Decide them under ✅ Approvals on Logbook's Home.",
          'Change how often you are reminded: Home → 🔔 Reminders.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      slackTeamId,
    );
  }
}
