import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { reportError } from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { runPeriodically } from '@common/utils/periodic.utils';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { ReceiptReminderMessageView } from '@modules/slack/receipts/views/receipt-reminder-message.view';
import { UsersService } from '@modules/users/services/users.service';
import { TransactionService } from 'src/database/transaction.service';
import { RECEIPT_ADMIN_ROLES } from 'src/receipts/constants/receipt-roles';
import { ReimbursementRemindersRepository } from 'src/receipts/repositories/reimbursement-reminders.repository';
import { ReceiptsMonthService } from 'src/receipts/services/receipts-month.service';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementOptOutsService } from 'src/receipts/services/reimbursement-opt-outs.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { IReceiptsMonth } from 'src/receipts/types/receipts-month.interface';
import { IReimbursementViewModel } from 'src/receipts/types/reimbursement.interface';
import { countSenders } from 'src/receipts/utils/month-overview';
import { dueDateOf } from 'src/receipts/utils/receipt-months';
import {
  ReimbursementReminderKind,
  remindersDue,
} from 'src/receipts/utils/reminders-due';

export const RECEIPT_REMINDER_JOB = 'receipt-reminder';
export const RECEIPTS_SUMMARY_JOB = 'receipts-summary';

// A reminder is due for a whole day from 09:00 UTC; a tick every 10 minutes
// sends it within 10 minutes of the hour, and the claim of
// (reimbursement, month, kind) keeps the day's later ticks from sending it
// again. The first tick is a few minutes after the start, so that a restart
// at 09:00 doesn't wait long.
const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_AFTER_MS = 5 * 60 * 1000;
// Each reminder is a DM of its own: as for the unsubmitted time reminder,
// 400 people are reminded in under two minutes.
const REMINDERS_PER_SECOND = 5;

interface IReminderJob {
  slackTeamId: string;
  userId: string;
  reimbursementId: string;
  month: string;
  kind: ReimbursementReminderKind.Opened | ReimbursementReminderKind.Due;
}

interface ISummaryJob {
  slackTeamId: string;
  userId: string;
  reimbursementId: string;
  month: string;
}

// Reminds people to send the receipts of a month: when it opens (the 1st),
// the day before it is due, and the day after Admin and Finance get what is
// still missing. The texts take the dates from the claim's month and the due
// day, not from the clock: a retry hours later says the same.
@Injectable()
export class ReceiptRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptRemindersService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly reimbursements: ReimbursementsService,
    private readonly optOuts: ReimbursementOptOutsService,
    private readonly receipts: ReceiptsService,
    private readonly months: ReceiptsMonthService,
    private readonly claims: ReimbursementRemindersRepository,
    private readonly usersService: UsersService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly view: ReceiptReminderMessageView,
    private readonly jobs: JobsService,
    private readonly transactions: TransactionService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IReminderJob>(RECEIPT_REMINDER_JOB, (job) =>
      this.sendReminder(job),
    );
    this.jobs.define<ISummaryJob>(RECEIPTS_SUMMARY_JOB, (job) =>
      this.sendSummary(job),
    );

    this.stopTimers = runPeriodically(() => this.remindAll(), {
      firstAfterMs: FIRST_TICK_AFTER_MS,
      everyMs: TICK_MS,
      logger: this.logger,
      failure: 'Could not remind of receipts',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // Every installed workspace's reminders due at `now`. Returns how many
  // messages it saved.
  public async remindAll(now = new Date()): Promise<number> {
    let saved = 0;

    for (const slackTeamId of await this.slackTeamsService.findInstalledIds()) {
      // One workspace failing leaves its reminder unclaimed for the next
      // tick, and the others still get theirs.
      try {
        saved += await this.remindWorkspace(slackTeamId, now);
      } catch (error) {
        this.logger.error(
          `Could not remind workspace ${slackTeamId} of receipts: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, { task: 'remind of receipts', slackTeamId });
      }
    }

    return saved;
  }

  private async remindWorkspace(slackTeamId: string, now: Date) {
    let saved = 0;

    for (const reimbursement of await this.reimbursements.findActive(
      slackTeamId,
    )) {
      for (const { kind, month } of remindersDue(now, reimbursement)) {
        saved += await this.claimAndSave(reimbursement, month, kind);
      }
    }

    return saved;
  }

  // The claim and the messages' jobs in one transaction: a failure leaves
  // neither, and the next tick tries again.
  private claimAndSave(
    reimbursement: IReimbursementViewModel,
    month: string,
    kind: ReimbursementReminderKind,
  ): Promise<number> {
    const { slackTeamId, id: reimbursementId } = reimbursement;

    return this.transactions.transaction(async () => {
      if (
        !(await this.claims.claim(slackTeamId, reimbursementId, month, kind))
      ) {
        return 0;
      }

      const overview = await this.months.getMonthForSystem(
        { reimbursementId, month },
        slackTeamId,
      );

      if (kind === ReimbursementReminderKind.Summary) {
        const recipients = this.hasNothingToSay(overview)
          ? []
          : await this.usersService.findMany({
              slackTeamId,
              roles: [...RECEIPT_ADMIN_ROLES],
            });

        await this.jobs.enqueueMany<ISummaryJob>(
          RECEIPTS_SUMMARY_JOB,
          recipients.map(({ id: userId }) => ({
            slackTeamId,
            userId,
            reimbursementId,
            month,
          })),
          { perSecond: REMINDERS_PER_SECOND },
        );

        return recipients.length;
      }

      const userIds = await this.findReminded(overview, kind);

      await this.jobs.enqueueMany<IReminderJob>(
        RECEIPT_REMINDER_JOB,
        userIds.map((userId) => ({
          slackTeamId,
          userId,
          reimbursementId,
          month,
          kind,
        })),
        { perSecond: REMINDERS_PER_SECOND },
      );

      return userIds.length;
    });
  }

  // Nobody sent and nobody is left to: there is nothing to summarize.
  private hasNothingToSay({ people, sentNothing }: IReceiptsMonth) {
    return !people.length && !sentNothing.length;
  }

  // Whoever sent nothing, and for the day before the due date also whoever
  // has a draft: opted out and inactive people never.
  private async findReminded(
    overview: IReceiptsMonth,
    kind: ReimbursementReminderKind,
  ): Promise<string[]> {
    const slackTeamId = overview.reimbursement.slackTeamId;
    const ids = new Set(overview.sentNothing.map(({ userId }) => userId));

    if (kind === ReimbursementReminderKind.Due) {
      const [withDrafts, active, optedOut] = await Promise.all([
        this.receipts.findUserIdsWithDrafts(slackTeamId),
        this.usersService.findMany({ slackTeamId }),
        this.optOuts.findOptedOutUserIds(
          overview.reimbursement.id,
          slackTeamId,
        ),
      ]);
      const activeIds = new Set(active.map(({ id }) => id));
      const optedOutIds = new Set(optedOut);

      for (const userId of withDrafts) {
        if (activeIds.has(userId) && !optedOutIds.has(userId)) {
          ids.add(userId);
        }
      }
    }

    return [...ids];
  }

  // The workspace may have been uninstalled since the job was saved, and the
  // reimbursement archived.
  private async findLiveReimbursement(
    slackTeamId: string,
    reimbursementId: string,
  ) {
    const [team, reimbursement] = await Promise.all([
      this.slackTeamsService.findOne({ id: slackTeamId }),
      this.reimbursements.findById(reimbursementId, slackTeamId),
    ]);

    return team && !team.uninstalled_at && reimbursement?.archivedAt === null
      ? reimbursement
      : null;
  }

  // What the person's state is when the job runs: nothing is sent to someone
  // who sent meanwhile, opted out or was deactivated.
  private async sendReminder({
    slackTeamId,
    userId,
    reimbursementId,
    month,
    kind,
  }: IReminderJob) {
    const [reimbursement, user, optedOut, sent, drafts] = await Promise.all([
      this.findLiveReimbursement(slackTeamId, reimbursementId),
      this.usersService.findOne({ id: userId, slackTeamId }),
      this.optOuts.findOptedOutUserIds(reimbursementId, slackTeamId),
      this.receipts.hasSent(userId, reimbursementId, month, slackTeamId),
      kind === ReimbursementReminderKind.Due
        ? this.receipts.countDrafts(userId, slackTeamId)
        : 0,
    ]);

    if (
      !reimbursement ||
      !user ||
      optedOut.includes(userId) ||
      (sent && !drafts)
    ) {
      return;
    }

    const facts = {
      reimbursementId,
      name: reimbursement.name,
      month,
      dueDate: dueDateOf(month, reimbursement.dueDay),
    };

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      kind === ReimbursementReminderKind.Opened
        ? this.view.opened(facts)
        : this.view.due(facts, { sentNothing: !sent, drafts }),
      slackTeamId,
    );
  }

  private async sendSummary({
    slackTeamId,
    userId,
    reimbursementId,
    month,
  }: ISummaryJob) {
    const [reimbursement, user] = await Promise.all([
      this.findLiveReimbursement(slackTeamId, reimbursementId),
      this.usersService.findOne({ id: userId, slackTeamId }),
    ]);

    // The role may have changed since the job was saved.
    if (!reimbursement || !user || !RECEIPT_ADMIN_ROLES.includes(user.role)) {
      return;
    }

    const overview = await this.months.getMonthForSystem(
      { reimbursementId, month },
      slackTeamId,
    );

    if (this.hasNothingToSay(overview)) {
      return;
    }

    const sent = countSenders(overview);

    await this.slackCommunicationService.postMessage(
      user.slack_id,
      this.view.summary({
        reimbursementId,
        name: reimbursement.name,
        month,
        dueDate: overview.dueDate,
        sent,
        of: sent + overview.sentNothing.length,
        waiting: overview.waiting,
      }),
      slackTeamId,
    );
  }
}
