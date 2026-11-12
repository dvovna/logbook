import { runPeriodically } from '@common/utils/periodic.utils';
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
import { START_WAITING_JOB } from '@modules/vacation-requests/constants/jobs';

const SYNC_EVERY_MS = 24 * 60 * 60 * 1000;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const FIRST_CHECK_AFTER_MS = 10 * 60 * 1000;

// Imports the members of every installed workspace once a day. Slack gives
// up on an event the app doesn't answer, e.g. a team_join while the app
// restarts, and nothing else would bring that person in. The import only
// adds who is missing (TeamUsersSyncService), so running it again is safe;
// each workspace is a job of its own, retried when Slack fails.
//
// Every process checks every hour, the first time ten minutes after its
// start, and imports the workspaces whose last import is a day old, each
// claimed first (slack_teams.members_synced_at): with two processes at once
// (a zero-downtime deploy) one of them imports it, and a restart doesn't
// import again.
//
// The same daily turn looks again at the workspace's time off requests that
// wait for anyone who can approve them: a request whose start failed, or
// one that waited before the app marked such requests while someone who can
// approve it was already there, starts then.
@Injectable()
export class MemberSyncScheduleService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MemberSyncScheduleService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly jobs: JobsService,
  ) {}

  public onModuleInit() {
    this.stopTimers = runPeriodically(() => this.syncDue(), {
      firstAfterMs: FIRST_CHECK_AFTER_MS,
      everyMs: CHECK_EVERY_MS,
      logger: this.logger,
      failure: 'Could not sync the members',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // The workspaces no process imported in the last day. Returns how many
  // this process imported.
  public async syncDue(now = new Date()): Promise<number> {
    const since = new Date(now.getTime() - SYNC_EVERY_MS);
    let synced = 0;

    for (const slackTeamId of await this.slackTeamsService.findInstalledIds()) {
      if (
        await this.slackTeamsService.claimMemberSync(slackTeamId, since, now)
      ) {
        await this.sync(slackTeamId);
        await this.jobs.enqueue(START_WAITING_JOB, { slackTeamId });
        synced += 1;
      }
    }

    return synced;
  }

  // Every installed workspace now, whenever it was imported last. Returns
  // how many workspaces it synced.
  public async syncAll(): Promise<number> {
    const ids = await this.slackTeamsService.findInstalledIds();

    for (const slackTeamId of ids) {
      await this.sync(slackTeamId);
    }

    return ids.length;
  }

  // One workspace after another, so a big installation doesn't call Slack
  // for all of them at once.
  private sync(slackTeamId: string) {
    return this.jobs.run<ISyncUsersJob>(SYNC_USERS_JOB, {
      slackTeamId,
      scheduled: true,
      askAboutNew: true,
    });
  }
}
