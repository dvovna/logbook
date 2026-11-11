import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { runPeriodically } from '@common/utils/periodic.utils';
import { TransactionService } from 'src/database/transaction.service';
import { SlackEventReceiptsRepository } from '@modules/slack-teams/slack-event-receipts.repository';

// Slack sends an event again 3 times at most, the last one 5 minutes after
// the first delivery; a receipt outlives them all.
export const KEEP_RECEIPTS_MS = 60 * 60_000;
const DELETE_EVERY_MS = 60 * 60_000;
const FIRST_DELETE_AFTER_MS = 5 * 60_000;

// Slack sends an event again when its answer took over 3 seconds or failed
// (X-Slack-Retry-Num), and the event's job is saved before the answer: each
// delivery would save one. The first delivery of an event leaves a receipt
// in the transaction that saves the job, so a later one finds it and saves
// nothing.
@Injectable()
export class SlackEventReceiptsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(SlackEventReceiptsService.name);

  private stopTimers?: () => void;

  public constructor(
    private readonly receiptsRepository: SlackEventReceiptsRepository,
    private readonly transactions: TransactionService,
  ) {}

  public onModuleInit() {
    this.stopTimers = runPeriodically(() => this.deleteOld(), {
      firstAfterMs: FIRST_DELETE_AFTER_MS,
      everyMs: DELETE_EVERY_MS,
      logger: this.logger,
      failure: 'Could not delete old Slack event receipts',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // Runs `save` (it saves the event's job) for the first delivery of the
  // event, in one transaction with its receipt: when saving fails, the
  // receipt goes too, and Slack's next delivery is taken. Resolves false for
  // a later delivery, which saves nothing. An event of a workspace the app
  // doesn't know, or without an ID, is taken every time, as before.
  public async takeOnce(
    workspaceSlackId: string | undefined,
    eventId: string | undefined,
    save: () => Promise<void>,
  ): Promise<boolean> {
    if (!workspaceSlackId || !eventId) {
      await save();

      return true;
    }

    return this.transactions.transaction(async () => {
      const { known, first } = await this.receiptsRepository.receive(
        workspaceSlackId,
        eventId,
        // The app's clock, which deleteOld counts on.
        new Date().toISOString(),
      );

      if (known && !first) {
        return false;
      }

      await save();

      return true;
    });
  }

  public deleteOld(): Promise<number> {
    return this.receiptsRepository.deleteReceivedBefore(
      new Date(Date.now() - KEEP_RECEIPTS_MS).toISOString(),
    );
  }
}
