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

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 60 * 1000;

// Deletes the workspaces uninstalled longer than
// UNINSTALLED_DATA_RETENTION_DAYS ago, with all their data, a minute after
// the start and then every six hours. Deleting twice deletes nothing more, so
// a run that fails is simply done by the next one.
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

  public async deleteExpired(): Promise<number> {
    const days = this.config.getOrThrow<number>(
      EnvironmentVariable.UninstalledDataRetentionDays,
    );
    const deleted = await this.slackTeamsService.deleteUninstalledBefore(
      new Date(Date.now() - days * DAY_MS),
    );

    if (deleted) {
      this.logger.log(
        `Deleted ${deleted} workspaces uninstalled over ${days} days ago, with their data`,
      );
    }

    return deleted;
  }
}
