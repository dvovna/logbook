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
import {
  formatDate,
  formatDateRange,
  getDateOnly,
} from '@common/utils/date.utils';
import { getDisplayTime } from '@common/utils/time.utils';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { IStuckStep } from '@modules/request-workflows/repositories/request-workflow-steps.repository';
import { IRequestWorkflowStepViewModel } from '@modules/request-workflows/types/request-workflow-step.interface';
import { IStuckEntryGroup } from 'src/time-entries/repositories/time-entries.repository';
import { runPeriodically } from '@common/utils/periodic.utils';
import { todayIso } from '@common/utils/period-presets';
import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import {
  dueReminders,
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
// How long the jobs of one run share their workspace's reads (SharedReads).
const SHARED_READ_TTL_MS = 60 * 1000;

interface IRemindApproverJob {
  slackTeamId: string;
  userId: string;
  // ISO timestamp: what has waited since before it is reminded of.
  waitedBefore: string;
  // ISO timestamp: what has waited for others since before it is listed for
  // HR (or the admins).
  stuckBefore: string;
}

interface IStuckLine {
  since: string;
  text: string;
}

interface IStuckRead {
  steps: IStuckStep[];
  entries: IStuckEntryGroup[];
}

interface IPresence {
  away: ReadonlySet<string>;
  // Everyone with the HR or Admin role who is at work: whom the day's absence
  // check can give the steps of an approver on time off.
  hrAndAdminsAtWork: IUserViewModel[];
  overseers: IUserViewModel[];
}

// A read the jobs of one run share: they go out REMINDERS_PER_SECOND and
// would each read the same. Kept SHARED_READ_TTL_MS, so a retry minutes
// later reads again; a failed read isn't kept.
class SharedReads<T> {
  private readonly reads = new Map<
    string,
    { readAt: number; read: Promise<T> }
  >();

  public get(key: string, read: () => Promise<T>): Promise<T> {
    const now = Date.now();

    for (const [old, { readAt }] of this.reads) {
      if (now - readAt > SHARED_READ_TTL_MS) {
        this.reads.delete(old);
      }
    }

    const cached = this.reads.get(key);

    if (cached) {
      return cached.read;
    }

    const promise = read();

    this.reads.set(key, { readAt: now, read: promise });
    promise.catch(() => this.reads.delete(key));

    return promise;
  }
}

// Reminds approvers of the time off steps and submitted time entries that
// have waited for their decision for APPROVER_REMINDER_AFTER_DAYS or more,
// and HR (or the admins, see STUCK_AFTER_DAYS) of what has waited for
// others for STUCK_AFTER_DAYS or more, in one DM, as often as each chose in
// Home → 🔔 Reminders (the choice that also sets the reminder of their own
// unsubmitted time), from 09:00 UTC. What waits for whom is the Approvals
// count's rule. A workspace claims the week or the day
// (slack_teams.approver_reminder_week/day) in the transaction that saves the
// messages' jobs, as TimeEntryRemindersService does, so a restart or a
// second process sends nothing more.
@Injectable()
export class ApproverRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApproverRemindersService.name);
  private stopTimers?: () => void;
  private readonly stuckReads = new SharedReads<IStuckRead>();
  private readonly presenceReads = new SharedReads<IPresence>();

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

  // Every installed workspace whose reminder is due and not sent yet.
  // Returns how many approvers it reminds.
  public async remindAll(now = new Date()): Promise<number> {
    const due = dueReminders(now);

    if (!due) {
      return 0;
    }

    let reminded = 0;

    for (const workspace of await this.slackTeamsService.findApproverRemindersDue(
      due.monday,
      due.day,
    )) {
      // One workspace failing leaves its week or day unclaimed for the next
      // tick, and the others still get theirs.
      try {
        reminded += await this.remindWorkspace(workspace.id, {
          monday: workspace.week ? due.monday : null,
          day: workspace.day ? due.day : null,
          now,
        });
      } catch (error) {
        this.logger.error(
          `Could not remind approvers of workspace ${workspace.id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, {
          task: 'remind approvers',
          slackTeamId: workspace.id,
        });
      }
    }

    return reminded;
  }

  // The week's reminder (`monday`) and the day's (`day`) of one workspace,
  // from one read of whom they go to. The reads go on the pool, at once, and
  // each claim with its jobs is a transaction of its own after them: one
  // that another process claimed meanwhile saves nothing.
  private async remindWorkspace(
    slackTeamId: string,
    {
      monday,
      day,
      now,
    }: { monday: string | null; day: string | null; now: Date },
  ): Promise<number> {
    const waitedBefore = daysBefore(now, APPROVER_REMINDER_AFTER_DAYS);
    const stuckBefore = daysBefore(now, STUCK_AFTER_DAYS);
    const runs: { claim: () => Promise<boolean>; reminders: TimeReminder[] }[] =
      [];

    if (monday) {
      runs.push({
        claim: () =>
          this.slackTeamsService.claimApproverReminderWeek(slackTeamId, monday),
        reminders: weeklyReminderGroups(monday),
      });
    }

    if (day) {
      runs.push({
        claim: () =>
          this.slackTeamsService.claimApproverReminderDay(slackTeamId, day),
        reminders: [TimeReminder.Daily],
      });
    }

    const [ids, stepSlackIds, presence] = await Promise.all([
      this.timeEntryApprovalsService.findApproversWaitingSince(
        slackTeamId,
        waitedBefore,
      ),
      this.requestWorkflowStepsService.findApproversWaitingSince(
        slackTeamId,
        waitedBefore,
      ),
      this.presenceOf(slackTeamId, getDateOnly(now)),
    ]);
    const { overseers } = presence;
    // An approver on time off is reminded only of the steps the day's
    // absence check won't skip.
    const slackIds = (
      await Promise.all(
        stepSlackIds.map(async (slackId) =>
          !presence.away.has(slackId) ||
          (
            await this.stepsLeftFor(
              { slack_id: slackId, slack_team_id: slackTeamId },
              waitedBefore,
              presence,
            )
          ).length
            ? [slackId]
            : [],
        ),
      )
    ).flat();
    // Nothing waited STUCK_AFTER_DAYS if nothing waited less: HR's jobs look
    // for it only then, and find out themselves.
    const people =
      ids.length || slackIds.length
        ? await this.usersService.findActiveWithReminder(
            slackTeamId,
            { ids: [...ids, ...overseers.map(({ id }) => id)], slackIds },
            runs.flatMap(({ reminders }) => reminders),
          )
        : [];
    let reminded = 0;

    // Claimed even when nobody is reminded, so the next ticks read nothing.
    for (const { claim, reminders } of runs) {
      reminded += await this.transactions.transaction(async () => {
        if (!(await claim())) {
          return 0;
        }

        const recipients = people.filter(({ time_reminder }) =>
          reminders.includes(time_reminder),
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

    return reminded;
  }

  // Who is on time off, and who is told what waits for others: everyone
  // with the HR role, else every admin, those at work first, as a fallback
  // level is made of them (RequestWorkflowService.moveOn).
  private async presenceOf(
    slackTeamId: string,
    today: string,
  ): Promise<IPresence> {
    const [people, away] = await Promise.all([
      this.usersService.findMany({
        slackTeamId,
        roles: [UserRole.HR, UserRole.Admin],
      }),
      this.usersService.findAway(slackTeamId, today),
    ]);
    const hrAndAdminsAtWork = people.filter(
      ({ slack_id }) => !away.has(slack_id),
    );

    return {
      away: new Set(away.keys()),
      hrAndAdminsAtWork,
      overseers:
        (
          fallbackApprovers(hrAndAdminsAtWork, '') ??
          fallbackApprovers(people, '')
        )?.approvers ?? [],
    };
  }

  // The steps that have waited for `approver`, who is on time off, since
  // before `before`, but those the day's absence check skips (it may not
  // have run yet): it skips the step of an approver on time off whenever
  // someone with the HR or Admin role other than the requester is at work,
  // as moveOn's fallback level never counts the requester. Time entries
  // leave such an approver out the same way ('told').
  private async stepsLeftFor(
    approver: { slack_id: string; slack_team_id: string },
    before: Date,
    { hrAndAdminsAtWork }: IPresence,
  ): Promise<IRequestWorkflowStepViewModel[]> {
    const steps =
      await this.requestWorkflowStepsService.findWaitingFor(approver);

    return steps.filter(
      ({ processed_at, step_data }) =>
        !!processed_at &&
        new Date(processed_at) < before &&
        !hrAndAdminsAtWork.some(({ id }) => id !== step_data.snapshot.user_id),
    );
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
    const presence = await this.readPresence(slackTeamId);
    const [timeOff, timeEntries, stuck] = await Promise.all([
      presence.away.has(user.slack_id)
        ? this.stepsLeftFor(user, before, presence).then(summarizeSteps)
        : this.requestWorkflowStepsService.summarizeWaitingSince(user, before),
      this.timeEntryApprovalsService.summarizeWaitingSince(user, before),
      this.stuckFor(user, stuckBefore, presence),
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

  // What has waited for others since before `stuckBefore`, oldest first,
  // when the user is whom a level with nobody else goes to (see
  // overseersOf); what waits for the user, or is their own, is left out.
  private async stuckFor(
    user: IUserViewModel,
    stuckBefore: string,
    { overseers }: IPresence,
  ): Promise<IStuckLine[]> {
    if (
      (user.role !== UserRole.HR && user.role !== UserRole.Admin) ||
      !overseers.some(({ id }) => id === user.id)
    ) {
      return [];
    }

    const { steps, entries } = await this.readStuck(
      user.slack_team_id,
      stuckBefore,
    );

    return [...stuckRequests(steps, user), ...stuckEntries(entries, user)].sort(
      (a, b) => a.since.localeCompare(b.since),
    );
  }

  // What is stuck, read once for the jobs of one run of a workspace (they
  // share `stuckBefore`).
  private readStuck(
    slackTeamId: string,
    stuckBefore: string,
  ): Promise<IStuckRead> {
    const before = new Date(stuckBefore);

    return this.stuckReads.get(`${slackTeamId}:${stuckBefore}`, async () => {
      const [steps, entries] = await Promise.all([
        this.requestWorkflowStepsService.findStuckSince(slackTeamId, before),
        this.timeEntryApprovalsService.findStuckSince(slackTeamId, before),
      ]);

      return { steps, entries };
    });
  }

  // Who is on time off today, read once for the jobs of one run of a
  // workspace.
  private readPresence(slackTeamId: string): Promise<IPresence> {
    const today = todayIso();

    return this.presenceReads.get(`${slackTeamId}:${today}`, () =>
      this.presenceOf(slackTeamId, today),
    );
  }
}

// The count and the oldest of `steps`, as summarizeWaitingSince gives them.
const summarizeSteps = (steps: IRequestWorkflowStepViewModel[]) => ({
  count: steps.length,
  oldest:
    steps
      .map(({ processed_at }) => processed_at!)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null,
});

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
