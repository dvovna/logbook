import { runPeriodically } from '@common/utils/periodic.utils';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import EnvironmentVariable from '@common/enums/environment-variable.enum';
import { reportError } from '@common/errors/error-reporter';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 60 * 1000;

// Deletes the workspaces uninstalled longer than
// UNINSTALLED_DATA_RETENTION_DAYS ago, with all their data, a minute after
// the start and then every six hours. Deleting twice deletes nothing more, so
// a workspace that fails is simply done by the next run.
@Injectable()
export class WorkspaceRetentionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WorkspaceRetentionService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly config: ConfigService,
  ) {}

  public onModuleInit() {
    this.stopTimers = runPeriodically(() => this.deleteExpired(), {
      firstAfterMs: FIRST_RUN_AFTER_MS,
      everyMs: EVERY_MS,
      logger: this.logger,
      failure: 'Could not delete uninstalled workspaces',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // One workspace per transaction: a workspace that can't be deleted (the
  // next run tries again) doesn't keep the others. Returns how many it
  // deleted.
  public async deleteExpired(): Promise<number> {
    const days = this.config.getOrThrow<number>(
      EnvironmentVariable.UninstalledDataRetentionDays,
    );
    const cutoff = new Date(Date.now() - days * DAY_MS);
    let deleted = 0;

    for (const id of await this.slackTeamsService.findUninstalledBefore(
      cutoff,
    )) {
      try {
        if (await this.slackTeamsService.deleteWorkspace(id, cutoff)) {
          deleted += 1;
        }
      } catch (error) {
        this.logger.error(
          `Could not delete the uninstalled workspace ${id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        // Its data outlives the retention period it was promised.
        reportError(error, {
          task: 'delete an uninstalled workspace',
          slackTeamId: id,
        });
      }
    }

    if (deleted) {
      this.logger.log(
        `Deleted ${deleted} workspaces uninstalled over ${days} days ago, with their data`,
      );
    }

    return deleted;
  }
}
