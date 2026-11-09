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
  private timers: NodeJS.Timeout[] = [];

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly config: ConfigService,
  ) {}

  public onModuleInit() {
    const run = () => {
      this.deleteExpired().catch((error: Error) =>
        this.logger.error(
          `Could not delete uninstalled workspaces: ${error.message}`,
        ),
      );
    };

    // unref: the timers alone don't keep the process running.
    this.timers = [
      setTimeout(run, FIRST_RUN_AFTER_MS).unref(),
      setInterval(run, EVERY_MS).unref(),
    ];
  }

  public onModuleDestroy() {
    this.timers.forEach((timer) => clearTimeout(timer));
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
