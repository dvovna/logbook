import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { JobsService } from '@common/jobs/jobs.service';
import {
  ISyncUsersJob,
  SYNC_USERS_JOB,
} from '@modules/team-setup/team-setup-workflow.service';

const EVERY_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_AFTER_MS = 10 * 60 * 1000;

// Imports the members of every installed workspace once a day, ten minutes
// after the start and then every 24 hours. Slack gives up on an event the
// app doesn't answer, e.g. a team_join while the app restarts, and nothing
// else would bring that person in. The import only adds who is missing
// (TeamUsersSyncService), so running it again is safe; each workspace is a
// job of its own, retried when Slack fails.
@Injectable()
export class MemberSyncScheduleService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MemberSyncScheduleService.name);
  private timers: NodeJS.Timeout[] = [];

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    const run = () => {
      this.syncAll().catch((error: Error) =>
        this.logger.error(`Could not sync the members: ${error.message}`),
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

  // One workspace after another, so a big installation doesn't call Slack
  // for all of them at once. Returns how many workspaces it synced.
  public async syncAll(): Promise<number> {
    const ids = await this.slackTeamsService.findInstalledIds();

    for (const slackTeamId of ids) {
      await this.jobs.run<ISyncUsersJob>(SYNC_USERS_JOB, { slackTeamId });
    }

    return ids.length;
  }
}
