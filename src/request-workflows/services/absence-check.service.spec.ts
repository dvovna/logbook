import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as errorReporter from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { TransactionService } from 'src/database/transaction.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import {
  AbsenceCheckService,
  SKIP_AWAY_JOB,
} from '@modules/request-workflows/services/absence-check.service';
import { ABSENCE_DAY_CHECKED } from '@modules/request-workflows/events/absence.events';

const DAY = '2026-06-18';
const DUE = new Date(`${DAY}T06:05:00Z`);

describe('AbsenceCheckService', () => {
  let slackTeams: {
    findAbsenceCheckDue: jest.Mock;
    claimAbsenceCheck: jest.Mock;
  };
  let users: { findAway: jest.Mock };
  let steps: { findMany: jest.Mock };
  let jobs: { define: jest.Mock; enqueueMany: jest.Mock };
  let eventEmitter: { emitAsync: jest.Mock };
  let service: AbsenceCheckService;
  // What ran inside TransactionService.transaction().
  let inTransaction: boolean;
  const reads: string[] = [];

  beforeEach(() => {
    reads.length = 0;
    inTransaction = false;
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(errorReporter, 'reportError').mockImplementation();
    slackTeams = {
      findAbsenceCheckDue: jest.fn().mockResolvedValue(['w1']),
      claimAbsenceCheck: jest.fn().mockResolvedValue(true),
    };
    users = {
      findAway: jest.fn(() => {
        reads.push(`away, in a transaction: ${inTransaction}`);

        return Promise.resolve(
          new Map([['UMAX', { userId: 'max', since: DAY, until: DAY }]]),
        );
      }),
    };
    steps = {
      findMany: jest.fn(() => {
        reads.push(`steps, in a transaction: ${inTransaction}`);

        return Promise.resolve([{ request_id: 'r1' }, { request_id: 'r1' }]);
      }),
    };
    jobs = {
      define: jest.fn(),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitter = { emitAsync: jest.fn().mockResolvedValue([]) };
    service = new AbsenceCheckService(
      slackTeams as unknown as SlackTeamsService,
      users as unknown as UsersService,
      steps as unknown as RequestWorkflowStepsService,
      {} as RequestWorkflowService,
      jobs as unknown as JobsService,
      {
        transaction: async <T>(work: () => Promise<T>) => {
          inTransaction = true;

          try {
            return await work();
          } finally {
            inTransaction = false;
          }
        },
      } as unknown as TransactionService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads on the pool, then claims the day and saves the skips in one transaction', async () => {
    await expect(service.checkAll(DUE)).resolves.toBe(1);

    expect(slackTeams.findAbsenceCheckDue).toHaveBeenCalledWith(DAY);
    expect(reads).toEqual([
      'away, in a transaction: false',
      'steps, in a transaction: false',
    ]);
    expect(slackTeams.claimAbsenceCheck).toHaveBeenCalledWith('w1', DAY);
    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      SKIP_AWAY_JOB,
      [{ requestId: 'r1', slackTeamId: 'w1' }],
      { perSecond: 5 },
    );
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      ABSENCE_DAY_CHECKED,
      expect.objectContaining({ slackTeamId: 'w1', date: DAY }),
    );
  });

  it('reads nothing more once every workspace was checked that day', async () => {
    slackTeams.findAbsenceCheckDue.mockResolvedValue([]);

    await expect(service.checkAll(DUE)).resolves.toBe(0);

    expect(users.findAway).not.toHaveBeenCalled();
    expect(slackTeams.claimAbsenceCheck).not.toHaveBeenCalled();
  });

  it('saves nothing when another process claimed the day meanwhile', async () => {
    slackTeams.claimAbsenceCheck.mockResolvedValue(false);

    await expect(service.checkAll(DUE)).resolves.toBe(0);

    expect(jobs.enqueueMany).not.toHaveBeenCalled();
    expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
  });

  it('does nothing before 06:00 UTC', async () => {
    await expect(service.checkAll(new Date(`${DAY}T05:59:00Z`))).resolves.toBe(
      0,
    );

    expect(slackTeams.findAbsenceCheckDue).not.toHaveBeenCalled();
  });
});
