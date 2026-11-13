import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { Logger } from '@nestjs/common';
import * as errorReporter from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { TransactionService } from 'src/database/transaction.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import {
  REMIND_UNSUBMITTED_JOB,
  TimeEntryRemindersService,
} from '@modules/slack/tabs/time-tracking/services/time-entry-reminders.service';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';

// Monday 2026-06-15, after 09:00 UTC: the reminder of that week is due.
const MONDAY = '2026-06-15';
const DUE = new Date('2026-06-15T09:05:00Z');

describe('TimeEntryRemindersService', () => {
  let service: TimeEntryRemindersService;
  let slackTeamsService: {
    findInstalledIds: jest.Mock;
    claimReminderWeek: jest.Mock;
    claimReminderDay: jest.Mock;
  };
  let timeEntriesService: { findUserIdsWithOpenUpTo: jest.Mock };
  let jobs: { define: jest.Mock; enqueueMany: jest.Mock };
  let error: jest.SpyInstance;
  let report: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    report = jest.spyOn(errorReporter, 'reportError').mockImplementation();
    slackTeamsService = {
      findInstalledIds: jest.fn().mockResolvedValue(['w1']),
      claimReminderWeek: jest.fn().mockResolvedValue(true),
      // The day's reminder went out already, unless a test says otherwise.
      claimReminderDay: jest.fn().mockResolvedValue(false),
    };
    timeEntriesService = {
      findUserIdsWithOpenUpTo: jest.fn().mockResolvedValue(['u1', 'u2']),
    };
    jobs = {
      define: jest.fn(),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
    };
    service = new TimeEntryRemindersService(
      slackTeamsService as unknown as SlackTeamsService,
      timeEntriesService as unknown as TimeEntriesService,
      {} as UsersService,
      {} as SlackCommunicationService,
      jobs as unknown as JobsService,
      {
        transaction: <T>(work: () => Promise<T>) => work(),
      } as unknown as TransactionService,
    );
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("saves every reminder of the workspace in one go, paced, from who has open time up to last week's end", async () => {
    await expect(service.remindWorkspace('w1', MONDAY)).resolves.toBe(2);

    expect(slackTeamsService.claimReminderWeek).toHaveBeenCalledWith(
      'w1',
      MONDAY,
    );
    expect(timeEntriesService.findUserIdsWithOpenUpTo).toHaveBeenCalledWith({
      slackTeamId: 'w1',
      dateTo: '2026-06-14',
      reminders: [TimeReminder.Weekly],
    });
    expect(jobs.enqueueMany).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      REMIND_UNSUBMITTED_JOB,
      [
        {
          slackTeamId: 'w1',
          userId: 'u1',
          dateTo: '2026-06-14',
          monday: MONDAY,
        },
        {
          slackTeamId: 'w1',
          userId: 'u2',
          dateTo: '2026-06-14',
          monday: MONDAY,
        },
      ],
      { perSecond: 5 },
    );
  });

  it('reminds the monthly ones too in the week of the first Monday', async () => {
    await service.remindWorkspace('w1', '2026-06-01');

    expect(timeEntriesService.findUserIdsWithOpenUpTo).toHaveBeenCalledWith({
      slackTeamId: 'w1',
      dateTo: '2026-05-31',
      reminders: [TimeReminder.Weekly, TimeReminder.Monthly],
    });
  });

  it('reminds the daily ones of what is open from before the day, once a day', async () => {
    slackTeamsService.claimReminderDay.mockResolvedValueOnce(true);

    // A Wednesday: the week was claimed on Monday.
    slackTeamsService.claimReminderWeek.mockResolvedValue(false);

    await expect(
      service.remindAll(new Date('2026-06-17T09:05:00Z')),
    ).resolves.toBe(2);

    expect(slackTeamsService.claimReminderDay).toHaveBeenCalledWith(
      'w1',
      '2026-06-17',
    );
    expect(timeEntriesService.findUserIdsWithOpenUpTo).toHaveBeenCalledWith({
      slackTeamId: 'w1',
      dateTo: '2026-06-16',
      reminders: [TimeReminder.Daily],
    });
    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      REMIND_UNSUBMITTED_JOB,
      [
        { slackTeamId: 'w1', userId: 'u1', dateTo: '2026-06-16' },
        { slackTeamId: 'w1', userId: 'u2', dateTo: '2026-06-16' },
      ],
      { perSecond: 5 },
    );
  });

  it('claims no day at the weekend, and the week still', async () => {
    await service.remindAll(new Date('2026-06-20T12:00:00Z'));

    expect(slackTeamsService.claimReminderDay).not.toHaveBeenCalled();
    expect(slackTeamsService.claimReminderWeek).toHaveBeenCalledWith(
      'w1',
      MONDAY,
    );
  });

  it('reminds nobody once the week was claimed', async () => {
    slackTeamsService.claimReminderWeek.mockResolvedValue(false);

    await expect(service.remindWorkspace('w1', MONDAY)).resolves.toBe(0);

    expect(timeEntriesService.findUserIdsWithOpenUpTo).not.toHaveBeenCalled();
    expect(jobs.enqueueMany).not.toHaveBeenCalled();
  });

  it('goes on with the other workspaces when one fails, and reports it', async () => {
    const timeout = new Error('canceling statement due to statement timeout');
    slackTeamsService.findInstalledIds.mockResolvedValue(['w1', 'w2']);
    timeEntriesService.findUserIdsWithOpenUpTo.mockImplementation(
      ({ slackTeamId }: { slackTeamId: string }) =>
        slackTeamId === 'w1'
          ? Promise.reject(timeout)
          : Promise.resolve(['u3']),
    );

    await expect(service.remindAll(DUE)).resolves.toBe(1);

    expect(jobs.enqueueMany).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      REMIND_UNSUBMITTED_JOB,
      [
        {
          slackTeamId: 'w2',
          userId: 'u3',
          dateTo: '2026-06-14',
          monday: MONDAY,
        },
      ],
      { perSecond: 5 },
    );
    expect(error).toHaveBeenCalledWith(
      'Could not remind workspace w1 of unsubmitted time: canceling statement due to statement timeout',
      expect.any(String),
    );
    expect(report).toHaveBeenCalledWith(timeout, {
      task: 'remind of unsubmitted time',
      slackTeamId: 'w1',
    });
  });

  it('looks every 10 minutes whether the reminder is due', async () => {
    jest.useFakeTimers({ now: DUE });
    service.onModuleInit();

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(slackTeamsService.claimReminderWeek).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(slackTeamsService.claimReminderWeek).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(slackTeamsService.claimReminderWeek).toHaveBeenCalledTimes(3);
  });
});
