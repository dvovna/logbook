import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { ValidationError } from '@common/errors/validation.error';
import { formatMoney } from '@common/utils/money.utils';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { personLabel } from '@modules/slack/common/views/data/labels';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { assertCanManageReceipts } from 'src/receipts/constants/receipt-roles';
import {
  IReceiptsArchiveLimits,
  RECEIPTS_ARCHIVE_LIMITS,
} from 'src/receipts/constants/receipts-archive';
import { ReceiptStatus } from 'src/receipts/enums/receipt-status.enum';
import { ReceiptFileStore } from 'src/receipts/services/receipt-file.store';
import {
  ReceiptsArchiveService,
  safeFileName,
} from 'src/receipts/services/receipts-archive.service';
import { ReceiptsMonthService } from 'src/receipts/services/receipts-month.service';
import { ReceiptsService } from 'src/receipts/services/receipts.service';
import { ReimbursementsService } from 'src/receipts/services/reimbursements.service';
import { monthLabel } from 'src/receipts/utils/receipt-months';

export const RECEIPT_OPEN_JOB = 'receipt-open';
export const RECEIPTS_MONTH_DOWNLOAD_JOB = 'receipts-month-download';
export const RECEIPTS_MONTH_PART_JOB = 'receipts-month-part';

export const FILE_DELETED = 'This file was deleted after the retention period.';

interface IReceiptOpenJob {
  receiptId: string;
  slackTeamId: string;
  userId: string;
}

interface IMonthDownloadJob {
  slackTeamId: string;
  userId: string;
  reimbursementId: string;
  month: string;
}

// One part of a month's archive: its receipts by ID, the files read when it
// runs. Part 1 carries the CSVs, made from the month as it is then.
interface IMonthPartJob extends IMonthDownloadJob {
  part: number;
  parts: number;
  receiptIds: string[];
}

// One download of a month to one person: the planning job and its parts.
const downloadKey = (userId: string, reimbursementId: string, month: string) =>
  `${userId}:${reimbursementId}:${month}`;

// Receipt files for Admin and Finance, in their DM with the app: one file
// (Open) or a month as a ZIP in parts (Download the month). Jobs: a restart
// or a failure of Slack is retried, and a file that never went is told of.
// The role is checked again when a job runs, by the same calls the screen
// makes before it saves one, since the file's bytes are read through a store
// that checks nothing.
@Injectable()
export class ReceiptFilesDmService implements OnModuleInit {
  private readonly logger = new Logger(ReceiptFilesDmService.name);

  public constructor(
    private readonly receipts: ReceiptsService,
    private readonly store: ReceiptFileStore,
    private readonly months: ReceiptsMonthService,
    private readonly archive: ReceiptsArchiveService,
    private readonly reimbursements: ReimbursementsService,
    private readonly slackTeamsService: SlackTeamsService,
    private readonly usersService: UsersService,
    private readonly dmFileService: DmFileService,
    private readonly jobs: JobsService,
    @Inject(RECEIPTS_ARCHIVE_LIMITS)
    private readonly limits: IReceiptsArchiveLimits,
  ) {}

  public onModuleInit() {
    this.jobs.define<IReceiptOpenJob>(
      RECEIPT_OPEN_JOB,
      async ({ slackTeamId, userId, receiptId }) => {
        const user = await this.activeUser(userId, slackTeamId);

        if (user) {
          await this.endsOnRefusal(() => this.sendFile(user, receiptId));
        }
      },
      { onGiveUp: (job) => this.tellFileNotSent(job) },
    );

    this.jobs.define<IMonthDownloadJob>(
      RECEIPTS_MONTH_DOWNLOAD_JOB,
      async ({ slackTeamId, userId, reimbursementId, month }) => {
        const user = await this.activeUser(userId, slackTeamId);

        if (user) {
          await this.endsOnRefusal(() =>
            this.planMonth(user, reimbursementId, month),
          );
        }
      },
      { onGiveUp: (job) => this.tellArchiveNotSent(job) },
    );

    this.jobs.define<IMonthPartJob>(
      RECEIPTS_MONTH_PART_JOB,
      async (job) => {
        const user = await this.activeUser(job.userId, job.slackTeamId);

        if (user) {
          await this.endsOnRefusal(() => this.sendPart(user, job));
        }
      },
      { onGiveUp: (job) => this.tellArchiveNotSent(job) },
    );
  }

  // Both start before the click's answer. They resolve false, saving
  // nothing, while the same file or month is still on its way to `user`.
  public startOpen(user: IUserViewModel, receiptId: string): Promise<boolean> {
    return this.jobs.enqueueSingleton<IReceiptOpenJob>(
      RECEIPT_OPEN_JOB,
      `${user.id}:${receiptId}`,
      { receiptId, slackTeamId: user.slack_team_id, userId: user.id },
      {
        firstRun: () =>
          this.endsOnRefusal(() => this.sendFile(user, receiptId)),
      },
    );
  }

  public startDownload(
    user: IUserViewModel,
    reimbursementId: string,
    month: string,
  ): Promise<boolean> {
    return this.jobs.enqueueSingleton<IMonthDownloadJob>(
      RECEIPTS_MONTH_DOWNLOAD_JOB,
      downloadKey(user.id, reimbursementId, month),
      {
        slackTeamId: user.slack_team_id,
        userId: user.id,
        reimbursementId,
        month,
      },
      {
        firstRun: () =>
          this.endsOnRefusal(() =>
            this.planMonth(user, reimbursementId, month),
          ),
        // Its parts, saved by it, are the same download.
        pendingAlso: [RECEIPTS_MONTH_PART_JOB],
      },
    );
  }

  // The person as they are now: one deactivated meanwhile gets nothing.
  private activeUser(userId: string, slackTeamId: string) {
    return this.usersService.findOne({ id: userId, slackTeamId });
  }

  // A receipt or a reimbursement that is gone, a person who lost the role:
  // a retry would find the same, so the job ends.
  private async endsOnRefusal(work: () => Promise<void>) {
    try {
      await work();
    } catch (error) {
      if (
        !(error instanceof ValidationError) &&
        !(error instanceof ForbiddenException) &&
        !(error instanceof NotFoundException)
      ) {
        throw error;
      }

      this.logger.warn(`Not sending a receipt file: ${error.message}`);
    }
  }

  private async sendFile(user: IUserViewModel, receiptId: string) {
    assertCanManageReceipts(user);

    const receipt = await this.receipts.findById(receiptId, user.slack_team_id);

    if (!receipt) {
      throw new NotFoundException(`Receipt ${receiptId} not found`);
    }

    if (receipt.status === ReceiptStatus.Draft) {
      throw new ValidationError(
        'This receipt has not been sent for checking yet.',
      );
    }

    const content = receipt.fileDeletedAt
      ? null
      : await this.store.get(receipt.id, user.slack_team_id);

    if (!content) {
      await this.dmFileService.say(user, FILE_DELETED);

      return;
    }

    const [owner, reimbursement, currency] = await Promise.all([
      this.usersService.findOne({
        id: receipt.userId,
        slackTeamId: user.slack_team_id,
        includeInactive: true,
      }),
      receipt.reimbursementId
        ? this.reimbursements.findById(
            receipt.reimbursementId,
            user.slack_team_id,
          )
        : null,
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);
    const intro = [
      owner ? escapeMrkdwn(personLabel(owner)) : 'Unknown person',
      reimbursement && escapeMrkdwn(reimbursement.name),
      receipt.month && monthLabel(receipt.month),
      receipt.amountCents !== null &&
        formatMoney(receipt.amountCents, currency),
    ]
      .filter(Boolean)
      .join(' · ');

    await this.dmFileService.send(user, {
      intro: `🧾 ${intro}`,
      title: receipt.fileName,
      filename: receipt.fileName,
      content,
    });
  }

  // Saves a job per part and ends: each part is read, zipped and sent by its
  // own job, which a failure retries alone, so that no run lasts long enough
  // for its saved copy to be run beside it. They start spaced out, so that a
  // big month leaves job slots to the rest.
  private async planMonth(
    user: IUserViewModel,
    reimbursementId: string,
    month: string,
  ) {
    const overview = await this.months.getMonth(
      { reimbursementId, month },
      user,
    );

    if (!overview.people.length) {
      await this.dmFileService.say(
        user,
        `There are no receipts for ${escapeMrkdwn(overview.reimbursement.name)}, ${monthLabel(month)}, to download.`,
      );

      return;
    }

    const currency = await this.slackTeamsService.getCurrency(
      user.slack_team_id,
    );
    const { parts } = this.archive.plan(overview, currency);
    // A month whose files are all gone still has its CSVs.
    const receiptIdsByPart = parts.length
      ? parts.map((files) => files.map(({ receiptId }) => receiptId))
      : [[]];

    await this.jobs.enqueueMany<IMonthPartJob>(
      RECEIPTS_MONTH_PART_JOB,
      receiptIdsByPart.map((receiptIds, i) => ({
        slackTeamId: user.slack_team_id,
        userId: user.id,
        reimbursementId,
        month,
        part: i + 1,
        parts: receiptIdsByPart.length,
        receiptIds,
      })),
      {
        perSecond: this.limits.partsPerSecond,
        singletonKey: downloadKey(user.id, reimbursementId, month),
      },
    );
  }

  // The month is read again (the role is checked by it): the files' names
  // and the CSVs are the month's as it is now. A receipt deleted since, or
  // whose file is past retention, is left out.
  private async sendPart(user: IUserViewModel, job: IMonthPartJob) {
    const [overview, currency] = await Promise.all([
      this.months.getMonth(
        { reimbursementId: job.reimbursementId, month: job.month },
        user,
      ),
      this.slackTeamsService.getCurrency(user.slack_team_id),
    ]);
    const { receiptsCsv, totalsCsv, parts } = this.archive.plan(
      overview,
      currency,
    );
    const files = new Map(parts.flat().map((file) => [file.receiptId, file]));
    const entries = await this.archive.readPart(
      job.receiptIds.flatMap((id) => files.get(id) ?? []),
      user.slack_team_id,
    );

    if (job.part === 1) {
      entries.unshift(
        { name: 'receipts.csv', content: Buffer.from(receiptsCsv) },
        { name: 'totals.csv', content: Buffer.from(totalsCsv) },
      );
    }

    const label = `${overview.reimbursement.name}, ${monthLabel(job.month)}`;
    const ofParts = `part ${job.part} of ${job.parts}`;

    // Without files:write part 1 says how to fix it; the others end quietly.
    await this.dmFileService.send(
      user,
      {
        intro: `📦 Receipts for ${escapeMrkdwn(label)} (${ofParts}).`,
        title: `Receipts for ${label} (${ofParts})`,
        filename: `${safeFileName(`Receipts ${overview.reimbursement.name} ${job.month.slice(0, 7)} ${ofParts}`)}.zip`,
        content: this.archive.buildPart(entries),
      },
      { quietWithoutFiles: job.part > 1 },
    );
  }

  private async tellFileNotSent({ slackTeamId, userId }: IReceiptOpenJob) {
    const user = await this.activeUser(userId, slackTeamId);

    if (user) {
      await this.dmFileService.say(
        user,
        "⚠️ I couldn't send the receipt's file: sending it kept failing for hours. Open it again from Receipts.",
      );
    }
  }

  private async tellArchiveNotSent({
    slackTeamId,
    userId,
    reimbursementId,
    month,
    ...part
  }: IMonthDownloadJob | IMonthPartJob) {
    const user = await this.activeUser(userId, slackTeamId);

    if (!user) {
      return;
    }

    const reimbursement = await this.reimbursements
      .findById(reimbursementId, slackTeamId)
      .catch(() => null);

    await this.dmFileService.say(
      user,
      `⚠️ I couldn't send the receipts${reimbursement ? ` of ${escapeMrkdwn(reimbursement.name)}` : ''} for ${monthLabel(month)}${'part' in part ? ` (part ${part.part} of ${part.parts})` : ''}: sending them kept failing for hours. Download them again from Receipts.`,
    );
  }
}
