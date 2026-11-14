import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import pluralize from 'pluralize';
import { reportError } from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import UserRole from '@common/enums/user-role.enum';
import { formatDate, formatDateRange } from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { IStuckStep } from '@modules/request-workflows/repositories/request-workflow-steps.repository';
import { IStuckEntryGroup } from 'src/time-entries/repositories/time-entries.repository';
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

// What waited longer is told to HR, or the admins when nobody has the HR
// role (whom a level with nobody else goes to), so they can decide it for an
// approver who is away.
export const STUCK_AFTER_DAYS = 5;

// Lines of the stuck list in one DM; the rest is "and N more".
const MAX_STUCK_LINES = 10;

const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_AFTER_MS = 5 * 60 * 1000;
const REMINDERS_PER_SECOND = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

interface IRemindApproverJob {
  slackTeamId: string;
  userId: string;
  // ISO timestamp: what has waited since before it is reminded of.
  waitedBefore: string;
  // ISO timestamp: what has waited for others since before it is listed for
  // HR (or the admins). A job saved before it existed lists nothing.
  stuckBefore?: string;
}

interface IStuckLine {
  since: string;
  text: string;
}

// Reminds approvers of the time off steps and submitted time entries that
// have waited for their decision for APPROVER_REMINDER_AFTER_DAYS or more,
// and HR (or the admins, see STUCK_AFTER_DAYS) of what has waited for
// others for STUCK_AFTER_DAYS or more, in one DM, as often as each chose in Home → 🔔 Reminders (the choice that
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
            now,
          );
        }

        if (day) {
          reminded += await this.remindWorkspace(
            slackTeamId,
            () =>
              this.slackTeamsService.claimApproverReminderDay(slackTeamId, day),
            [TimeReminder.Daily],
            now,
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
    now: Date,
  ): Promise<number> {
    const waitedBefore = daysBefore(now, APPROVER_REMINDER_AFTER_DAYS);
    const stuckBefore = daysBefore(now, STUCK_AFTER_DAYS);

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

      if (!ids.length && !slackIds.length) {
        return 0;
      }

      // Nothing waited STUCK_AFTER_DAYS if nothing waited less: HR's jobs
      // look for it only then, and find out themselves.
      const overseers = (await this.overseersOf(slackTeamId)).map(
        ({ id }) => id,
      );
      const recipients = await this.usersService.findActiveWithReminder(
        slackTeamId,
        { ids: [...ids, ...overseers], slackIds },
        reminders,
      );

      await this.jobs.enqueueMany<IRemindApproverJob>(
        REMIND_APPROVER_JOB,
        recipients.map(({ id }) => ({
          slackTeamId,
          userId: id,
          waitedBefore: waitedBefore.toISOString(),
          stuckBefore: stuckBefore.toISOString(),
        })),
        { perSecond: REMINDERS_PER_SECOND },
      );

      return recipients.length;
    });
  }

  // Everyone active with the HR role, else every active admin.
  private async overseersOf(slackTeamId: string): Promise<IUserViewModel[]> {
    const people = await this.usersService.findMany({
      slackTeamId,
      roles: [UserRole.HR, UserRole.Admin],
    });

    return fallbackApprovers(people, '')?.approvers ?? [];
  }

  // What still waits when the job runs: nothing is sent once it was all
  // decided, to someone deactivated, or to someone who turned reminders
  // off since.
  private async sendReminder({
    slackTeamId,
    userId,
    waitedBefore,
    stuckBefore,
  }: IRemindApproverJob) {
    const user = await this.usersService.findOne({ id: userId, slackTeamId });

    if (!user?.is_active || user.time_reminder === TimeReminder.Off) {
      return;
    }

    const before = new Date(waitedBefore);
    const [timeOff, timeEntries, stuck] = await Promise.all([
      this.requestWorkflowStepsService.summarizeWaitingSince(user, before),
      this.timeEntryApprovalsService.summarizeWaitingSince(user, before),
      stuckBefore ? this.stuckFor(user, new Date(stuckBefore)) : [],
    ]);

    if (!timeOff.count && !timeEntries.count && !stuck.length) {
      return;
    }

    const own = [
      ':hourglass_flowing_sand: Still waiting for your decision:',
      timeOff.count > 0 &&
        `• ${pluralize('time off request', timeOff.count, true)}, the oldest since ${formatDate(timeOff.oldest!)}`,
      timeEntries.count > 0 &&
        `• ${pluralize('time entry', timeEntries.count, true)} of ${pluralize('person', timeEntries.people, true)}, the oldest since ${formatDate(timeEntries.oldest!)}`,
      "Decide them under ✅ Approvals on Logbook's Home.",
    ];
    const others = [
      `:rotating_light: Waiting for someone else for more than ${STUCK_AFTER_DAYS} days:`,
      ...stuck.slice(0, MAX_STUCK_LINES).map(({ text }) => `• ${text}`),
      stuck.length > MAX_STUCK_LINES &&
        `…and ${stuck.length - MAX_STUCK_LINES} more`,
      'You can decide them for the approvers under ✅ Approvals → All pending requests and All pending entries.',
    ];

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      {
        text: [
          ...(timeOff.count || timeEntries.count ? own : []),
          ...(stuck.length ? others : []),
          'Change how often you are reminded: Home → 🔔 Reminders.',
        ]
          .filter(Boolean)
          .join('\n'),
      },
      slackTeamId,
    );
  }

  // What has waited for others since before `before`, oldest first, when
  // the user is whom a level with nobody else goes to (see overseersOf);
  // what waits for the user, or is their own, is left out.
  private async stuckFor(
    user: IUserViewModel,
    before: Date,
  ): Promise<IStuckLine[]> {
    if (user.role !== UserRole.HR && user.role !== UserRole.Admin) {
      return [];
    }

    if (
      user.role === UserRole.Admin &&
      !(await this.overseersOf(user.slack_team_id)).some(
        ({ id }) => id === user.id,
      )
    ) {
      return [];
    }

    const [steps, entries] = await Promise.all([
      this.requestWorkflowStepsService.findStuckSince(
        user.slack_team_id,
        before,
      ),
      this.timeEntryApprovalsService.findStuckSince(user.slack_team_id, before),
    ]);

    return [...stuckRequests(steps, user), ...stuckEntries(entries, user)].sort(
      (a, b) => a.since.localeCompare(b.since),
    );
  }
}

const daysBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * DAY_MS);

const nameOf = (person: { name: string | null; email: string | null }) =>
  escapeMrkdwn(personLabel(person));

const waitingFor = (approvers: Set<string>) =>
  approvers.size ? [...approvers].sort().join(', ') : 'its approvers';

const stuckRequests = (
  steps: IStuckStep[],
  user: IUserViewModel,
): IStuckLine[] => {
  const requests = new Map<
    string,
    { step: IStuckStep; approvers: Set<string>; since: string; mine: boolean }
  >();

  for (const step of steps) {
    const request = requests.get(step.request_id) ?? {
      step,
      approvers: new Set<string>(),
      since: step.asked_at,
      mine: step.requester_id === user.id,
    };

    if (step.approver_slack_id === user.slack_id) {
      request.mine = true;
    }

    if (step.approver_slack_id) {
      request.approvers.add(
        nameOf({ name: step.approver_name, email: step.approver_email }),
      );
    }

    request.since =
      step.asked_at < request.since ? step.asked_at : request.since;
    requests.set(step.request_id, request);
  }

  return [...requests.values()]
    .filter(({ mine }) => !mine)
    .map(({ step, approvers, since }) => ({
      since,
      text: `*${nameOf({ name: step.requester_name, email: step.requester_email })}*: time off ${formatDateRange(step.start_date, step.end_date)}, waiting for ${waitingFor(approvers)} since ${formatDate(since)}`,
    }));
};

const stuckEntries = (
  groups: IStuckEntryGroup[],
  user: IUserViewModel,
): IStuckLine[] => {
  // A row a team, owner and approver: the team's entries count once.
  const teams = new Map<
    string,
    { group: IStuckEntryGroup; approvers: Set<string>; mine: boolean }
  >();

  for (const group of groups) {
    const key = `${group.owner_id}:${group.team_id ?? ''}`;
    const team = teams.get(key) ?? {
      group,
      approvers: new Set<string>(),
      mine: group.owner_id === user.id,
    };

    if (group.approver_id === user.id) {
      team.mine = true;
    }

    if (group.approver_id) {
      team.approvers.add(
        nameOf({ name: group.approver_name, email: group.approver_email }),
      );
    }

    teams.set(key, team);
  }

  const owners = new Map<
    string,
    {
      group: IStuckEntryGroup;
      entries: number;
      minutes: number;
      since: string;
      approvers: Set<string>;
    }
  >();

  for (const { group, approvers, mine } of teams.values()) {
    if (mine) {
      continue;
    }

    const owner = owners.get(group.owner_id) ?? {
      group,
      entries: 0,
      minutes: 0,
      since: group.oldest,
      approvers: new Set<string>(),
    };

    owner.entries += group.entries;
    owner.minutes += group.minutes;
    owner.since = group.oldest < owner.since ? group.oldest : owner.since;
    approvers.forEach((approver) => owner.approvers.add(approver));
    owners.set(group.owner_id, owner);
  }

  return [...owners.values()].map(
    ({ group, entries, minutes, since, approvers }) => ({
      since,
      text: `*${nameOf({ name: group.owner_name, email: group.owner_email })}*: ${pluralize('time entry', entries, true)} (${getDisplayTime(minutes)}), waiting for ${waitingFor(approvers)} since ${formatDate(since)}`,
    }),
  );
};
