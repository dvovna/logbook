import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { ValidationError } from '@common/errors/validation.error';
import { getDisplayTime } from '@common/utils/time.utils';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { DmFileService } from '@modules/slack/common/services/dm-file.service';
import { escapeMrkdwn } from '@modules/slack/common/utils/mrkdwn.utils';
import { IBillingSnapshotCsvJob } from '@modules/slack/tabs/billing-snapshots/types/billing-snapshot-csv-job.interface';
import {
  snapshotAmount,
  snapshotName,
} from '@modules/slack/tabs/billing-snapshots/views/billing-snapshots-tab.view';
import { BillingSnapshotExportService } from 'src/billing/services/billing-snapshot-export.service';
import { BillingSnapshotsService } from 'src/billing/services/billing-snapshots.service';
import { IBillingSnapshot } from 'src/billing/types/billing-snapshot.types';

export const BILLING_SNAPSHOT_CSV_JOB = 'billing-snapshot-csv';

// "Acme, 1–30 Jun 2026", escaped (the message is mrkdwn).
const nameOf = (snapshot: IBillingSnapshot) =>
  escapeMrkdwn(snapshotName(snapshot).replace(' · ', ', '));

// Sends a billing snapshot as a CSV file in a DM with the person who asked;
// the client's name is escaped in the message, which is mrkdwn. A job: a
// restart or a failure of Slack is retried, and a file that never went is
// told of.
@Injectable()
export class BillingSnapshotDmService implements OnModuleInit {
  private readonly logger = new Logger(BillingSnapshotDmService.name);

  public constructor(
    private readonly exportService: BillingSnapshotExportService,
    private readonly snapshotsService: BillingSnapshotsService,
    private readonly usersService: UsersService,
    private readonly dmFileService: DmFileService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IBillingSnapshotCsvJob>(
      BILLING_SNAPSHOT_CSV_JOB,
      async ({ slackTeamId, userId, snapshotId }) => {
        // The person as they are now: one deactivated meanwhile gets nothing.
        const user = await this.usersService.findOne({
          id: userId,
          slackTeamId,
        });

        if (user) {
          await this.deliver(user, snapshotId);
        }
      },
      { onGiveUp: (job) => this.tellNotSent(job) },
    );
  }

  // Saves the job that sends the CSV before the click gets its answer.
  // Resolves false, saving nothing, while the same snapshot's CSV is still
  // on its way to `user`.
  public start(user: IUserViewModel, snapshotId: string): Promise<boolean> {
    return this.jobs.enqueueSingleton<IBillingSnapshotCsvJob>(
      BILLING_SNAPSHOT_CSV_JOB,
      `${user.id}:${snapshotId}`,
      { slackTeamId: user.slack_team_id, userId: user.id, snapshotId },
      { firstRun: () => this.deliver(user, snapshotId) },
    );
  }

  private async send(user: IUserViewModel, snapshotId: string) {
    const { snapshot, filename, content } = await this.exportService.getCsv(
      snapshotId,
      user,
    );
    const entries = `${snapshot.entryCount} ${snapshot.entryCount === 1 ? 'entry' : 'entries'}`;

    await this.dmFileService.send(user, {
      intro: `📄 Billing snapshot, ${nameOf(snapshot)}: ${entries}, ${getDisplayTime(snapshot.total_minutes)}, ${snapshotAmount(snapshot)}.`,
      title: `Billing snapshot, ${snapshotName(snapshot).replace(' · ', ', ')}`,
      filename,
      content,
    });
  }

  // A snapshot unlocked since the click, or a person who no longer works
  // with snapshots, won't change on a retry: the job ends.
  private async deliver(user: IUserViewModel, snapshotId: string) {
    try {
      await this.send(user, snapshotId);
    } catch (error) {
      if (
        !(error instanceof ValidationError) &&
        !(error instanceof ForbiddenException)
      ) {
        throw error;
      }

      this.logger.warn(
        `Not sending billing snapshot ${snapshotId}: ${error.message}`,
      );
    }
  }

  private async tellNotSent({
    slackTeamId,
    userId,
    snapshotId,
  }: IBillingSnapshotCsvJob) {
    const user = await this.usersService.findOne({ id: userId, slackTeamId });

    if (!user) {
      return;
    }

    const snapshot = await this.snapshotsService
      .findOne(snapshotId, user)
      .catch(() => null);

    await this.dmFileService.say(
      user,
      `⚠️ I couldn't send the CSV of the billing snapshot${snapshot ? ` ${nameOf(snapshot)}` : ''}: sending it kept failing for hours. Send it again from Reports → Billing snapshots.`,
    );
  }
}
