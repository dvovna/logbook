import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TransactionService } from 'src/database/transaction.service';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { reportError } from '@common/errors/error-reporter';
import { DAY_MS } from '@common/utils/date.utils';
import { runPeriodically } from '@common/utils/periodic.utils';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { DRAFT_LIFETIME_DAYS } from '@modules/receipts/constants/receipt-limits';
import { ReceiptsRepository } from '@modules/receipts/repositories/receipts.repository';
import { ReceiptFileStore } from '@modules/receipts/services/receipt-file.store';

const EVERY_MS = 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 15 * 60 * 1000;
// One statement deletes a batch's bytes, at most 10 MB a file, within the
// 10 s statement timeout: deleting 240 MB took 0.4 s on a local disk.
const BATCH_SIZE = 50;

// Deletes what isn't kept for ever: drafts nobody finished within
// DRAFT_LIFETIME_DAYS, with their files, and the files of the other receipts
// after RECEIPT_FILE_RETENTION_DAYS from their decision (the receipt stays,
// with file_deleted_at; one still waiting for Finance keeps its file). Every process sweeps every hour; a second
// sweep finds nothing left, and one at the same moment skips the rows the
// first holds.
@Injectable()
export class ReceiptRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReceiptRetentionService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly receipts: ReceiptsRepository,
    private readonly files: ReceiptFileStore,
    private readonly slackTeams: SlackTeamsService,
    private readonly transactions: TransactionService,
    private readonly config: ConfigService,
  ) {}

  public onModuleInit() {
    this.stopTimers = runPeriodically(() => this.sweep(), {
      firstAfterMs: FIRST_RUN_AFTER_MS,
      everyMs: EVERY_MS,
      logger: this.logger,
      failure: 'Could not delete expired receipts',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // A workspace that fails is logged and reported, and doesn't keep the
  // others; the next sweep tries it again.
  public async sweep(
    now: Date = new Date(),
  ): Promise<{ files: number; drafts: number }> {
    const retentionDays = this.config.getOrThrow<number>(
      EnvironmentVariable.ReceiptFileRetentionDays,
    );
    const total = { files: 0, drafts: 0 };

    for (const slackTeamId of await this.slackTeams.findInstalledIds()) {
      try {
        const swept = await this.sweepWorkspace(slackTeamId, now);

        total.files += swept.files;
        total.drafts += swept.drafts;
      } catch (error) {
        this.logger.error(
          `Could not delete the expired receipts of workspace ${slackTeamId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, {
          task: 'delete expired receipts',
          slackTeamId,
        });
      }
    }

    if (total.files || total.drafts) {
      this.logger.log(
        `Deleted ${total.drafts} unfinished receipts and the files of ${total.files} receipts older than ${retentionDays} days`,
      );
    }

    return total;
  }

  public async sweepWorkspace(
    slackTeamId: string,
    now: Date = new Date(),
  ): Promise<{ files: number; drafts: number }> {
    const retentionDays = this.config.getOrThrow<number>(
      EnvironmentVariable.ReceiptFileRetentionDays,
    );
    const drafts = await this.receipts.deleteDraftsBefore(
      slackTeamId,
      new Date(now.getTime() - DRAFT_LIFETIME_DAYS * DAY_MS),
    );
    const files = await this.deleteFiles(
      slackTeamId,
      new Date(now.getTime() - retentionDays * DAY_MS),
      now,
    );

    return { files, drafts };
  }

  private async deleteFiles(
    slackTeamId: string,
    cutoff: Date,
    now: Date,
  ): Promise<number> {
    let deleted = 0;
    let batch: number;

    do {
      batch = await this.transactions.transaction(async () => {
        const ids = await this.receipts.lockIdsWithFilesBefore(
          slackTeamId,
          cutoff,
          BATCH_SIZE,
        );

        await this.files.delete(ids, slackTeamId);
        await this.receipts.markFilesDeleted(slackTeamId, ids, now);

        return ids.length;
      });
      deleted += batch;
    } while (batch === BATCH_SIZE);

    return deleted;
  }
}
