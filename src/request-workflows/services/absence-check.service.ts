import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { reportError } from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { getDateOnly } from '@common/utils/date.utils';
import { runPeriodically } from '@common/utils/periodic.utils';
import { TransactionService } from 'src/database/transaction.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import {
  ABSENCE_DAY_CHECKED,
  AbsenceDayCheckedEvent,
} from '@modules/request-workflows/events/absence.events';

export const SKIP_AWAY_JOB = 'workflow-skip-away';

interface ISkipAwayJob {
  requestId: string;
  slackTeamId: string;
}

// The day's check starts from this hour, so that time off approved for the
// day early is in before the first one.
const CHECK_FROM_HOUR_UTC = 6;
const TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_AFTER_MS = 5 * 60 * 1000;
// Each skip is a job and may post DMs.
const SKIPS_PER_SECOND = 5;

// Once a UTC day, from 06:00, moves on the requests that wait for approvers
// who are on time off that day (RequestWorkflowService.skipAway), and when
// time off for today is approved, for that person at once. A tick reads
// which workspaces haven't been checked that day first, so the ticks after
// read nothing more; a workspace's reads go on the pool, and it claims the
// day (slack_teams.absence_check_date) in a short transaction that saves the
// jobs, so a restart or a second process checks nothing twice.
@Injectable()
export class AbsenceCheckService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbsenceCheckService.name);
  private stopTimers?: () => void;

  public constructor(
    private readonly slackTeamsService: SlackTeamsService,
    private readonly usersService: UsersService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly jobs: JobsService,
    private readonly transactions: TransactionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public onModuleInit() {
    this.jobs.define<ISkipAwayJob>(
      SKIP_AWAY_JOB,
      ({ requestId, slackTeamId }) =>
        this.requestWorkflowService.skipAway(requestId, slackTeamId),
    );

    this.stopTimers = runPeriodically(() => this.checkAll(), {
      firstAfterMs: FIRST_TICK_AFTER_MS,
      everyMs: TICK_MS,
      logger: this.logger,
      failure: 'Could not check for approvers on time off',
    });
  }

  public onModuleDestroy() {
    this.stopTimers?.();
  }

  // Every installed workspace not checked today, from 06:00 UTC. Returns
  // how many it checked.
  public async checkAll(now = new Date()): Promise<number> {
    if (now.getUTCHours() < CHECK_FROM_HOUR_UTC) {
      return 0;
    }

    const date = getDateOnly(now);
    let checked = 0;

    for (const slackTeamId of await this.slackTeamsService.findAbsenceCheckDue(
      date,
    )) {
      // One workspace failing leaves its day unclaimed for the next tick.
      try {
        if (await this.checkWorkspace(slackTeamId, date)) {
          checked++;
        }
      } catch (error) {
        this.logger.error(
          `Could not check workspace ${slackTeamId} for approvers on time off: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, {
          task: 'check for approvers on time off',
          slackTeamId,
        });
      }
    }

    return checked;
  }

  // False when the workspace's day was checked already (or it is gone).
  // What waits for whom is read before the claim, on the pool: the claim
  // holds the workspace's row, which other writes wait for.
  public async checkWorkspace(
    slackTeamId: string,
    date: string,
  ): Promise<boolean> {
    const away = await this.usersService.findAway(slackTeamId, date);
    const requestIds = await this.requestsWaitingFor(slackTeamId, [
      ...away.keys(),
    ]);

    return this.transactions.transaction(async () => {
      if (
        !(await this.slackTeamsService.claimAbsenceCheck(slackTeamId, date))
      ) {
        return false;
      }

      await this.jobs.enqueueMany<ISkipAwayJob>(
        SKIP_AWAY_JOB,
        requestIds.map((requestId) => ({ requestId, slackTeamId })),
        { perSecond: SKIPS_PER_SECOND },
      );
      await this.eventEmitter.emitAsync(
        ABSENCE_DAY_CHECKED,
        new AbsenceDayCheckedEvent(slackTeamId, date),
      );

      return true;
    });
  }

  // Time off for today was approved for this person: the requests waiting
  // for them move on now, not at the next day's check. Runs in the caller's
  // transaction, so the jobs are saved with the approval.
  public async checkPerson(slackTeamId: string, slackUserId: string) {
    const requestIds = await this.requestsWaitingFor(slackTeamId, [
      slackUserId,
    ]);

    for (const requestId of requestIds) {
      await this.jobs.enqueue<ISkipAwayJob>(SKIP_AWAY_JOB, {
        requestId,
        slackTeamId,
      });
    }
  }

  private async requestsWaitingFor(
    slackTeamId: string,
    slackUserIds: string[],
  ) {
    if (!slackUserIds.length) {
      return [];
    }

    const steps = await this.requestWorkflowStepsService.findMany({
      slackTeamId,
      slackUserIds,
      completed: false,
      processed: true,
    });

    return [...new Set(steps.map((step) => step.request_id))];
  }
}
