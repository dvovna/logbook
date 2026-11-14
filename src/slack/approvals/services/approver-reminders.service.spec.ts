import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { Logger } from '@nestjs/common';
import * as errorReporter from '@common/errors/error-reporter';
import { JobsService } from '@common/jobs/jobs.service';
import { TransactionService } from 'src/database/transaction.service';
import { SlackTeamsService } from '@modules/slack-teams/slack-teams.service';
import { UsersService } from '@modules/users/services/users.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import {
  ApproverRemindersService,
  REMIND_APPROVER_JOB,
} from '@modules/slack/approvals/services/approver-reminders.service';

// Monday 2026-06-15, after 09:00 UTC.
const MONDAY = '2026-06-15';
const DUE = new Date('2026-06-15T09:05:00Z');
const TWO_DAYS_BEFORE = '2026-06-13T09:05:00.000Z';

describe('ApproverRemindersService', () => {
  let service: ApproverRemindersService;
  let slackTeamsService: {
    findInstalledIds: jest.Mock;
    claimApproverReminderWeek: jest.Mock;
    claimApproverReminderDay: jest.Mock;
  };
  let usersService: { findActiveWithReminder: jest.Mock; findOne: jest.Mock };
  let steps: {
    findApproversWaitingSince: jest.Mock;
    summarizeWaitingSince: jest.Mock;
  };
  let entries: {
    findApproversWaitingSince: jest.Mock;
    summarizeWaitingSince: jest.Mock;
  };
  let slack: { postMessage: jest.Mock };
  let jobs: { define: jest.Mock; enqueueMany: jest.Mock };
  let report: jest.SpyInstance;

  const sendJob = (payload: object) =>
    (jobs.define.mock.calls[0][1] as (job: object) => Promise<void>)(payload);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    report = jest.spyOn(errorReporter, 'reportError').mockImplementation();
    slackTeamsService = {
      findInstalledIds: jest.fn().mockResolvedValue(['w1']),
      claimApproverReminderWeek: jest.fn().mockResolvedValue(true),
      claimApproverReminderDay: jest.fn().mockResolvedValue(false),
    };
    usersService = {
      findActiveWithReminder: jest
        .fn()
        .mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]),
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        slack_id: 'U1',
        is_active: true,
        time_reminder: TimeReminder.Weekly,
      }),
    };
    steps = {
      findApproversWaitingSince: jest.fn().mockResolvedValue(['U2']),
      summarizeWaitingSince: jest
        .fn()
        .mockResolvedValue({ count: 2, oldest: '2026-06-03T10:00:00.000Z' }),
    };
    entries = {
      findApproversWaitingSince: jest.fn().mockResolvedValue(['u1']),
      summarizeWaitingSince: jest.fn().mockResolvedValue({
        count: 14,
        people: 3,
        oldest: '2026-06-05T08:00:00.000Z',
      }),
    };
    slack = { postMessage: jest.fn().mockResolvedValue(undefined) };
    jobs = {
      define: jest.fn(),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
    };
    service = new ApproverRemindersService(
      slackTeamsService as unknown as SlackTeamsService,
      usersService as unknown as UsersService,
      steps as unknown as RequestWorkflowStepsService,
      entries as unknown as TimeEntryApprovalsService,
      slack as unknown as SlackCommunicationService,
      jobs as unknown as JobsService,
      {
        transaction: <T>(work: () => Promise<T>) => work(),
      } as unknown as TransactionService,
    );
    jest.useFakeTimers({ now: DUE });
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("claims the week and saves one paced job per approver who chose the week's reminder", async () => {
    await expect(service.remindAll(DUE)).resolves.toBe(2);

    expect(slackTeamsService.claimApproverReminderWeek).toHaveBeenCalledWith(
      'w1',
      MONDAY,
    );
    const before = new Date(TWO_DAYS_BEFORE);
    expect(entries.findApproversWaitingSince).toHaveBeenCalledWith(
      'w1',
      before,
    );
    expect(steps.findApproversWaitingSince).toHaveBeenCalledWith('w1', before);
    expect(usersService.findActiveWithReminder).toHaveBeenCalledWith(
      'w1',
      { ids: ['u1'], slackIds: ['U2'] },
      [TimeReminder.Weekly],
    );
    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      REMIND_APPROVER_JOB,
      [
        { slackTeamId: 'w1', userId: 'u1', waitedBefore: TWO_DAYS_BEFORE },
        { slackTeamId: 'w1', userId: 'u2', waitedBefore: TWO_DAYS_BEFORE },
      ],
      { perSecond: 5 },
    );
  });

  it('saves nothing when the week was claimed already', async () => {
    slackTeamsService.claimApproverReminderWeek.mockResolvedValue(false);

    await expect(service.remindAll(DUE)).resolves.toBe(0);

    expect(usersService.findActiveWithReminder).not.toHaveBeenCalled();
    expect(jobs.enqueueMany).not.toHaveBeenCalled();
  });

  it('reminds the daily ones on a working day', async () => {
    slackTeamsService.claimApproverReminderDay.mockResolvedValue(true);
    const wednesday = new Date('2026-06-17T09:30:00Z');

    await service.remindAll(wednesday);

    expect(slackTeamsService.claimApproverReminderDay).toHaveBeenCalledWith(
      'w1',
      '2026-06-17',
    );
    expect(usersService.findActiveWithReminder).toHaveBeenCalledWith(
      'w1',
      expect.anything(),
      [TimeReminder.Daily],
    );
  });

  it('does nothing before 09:00 UTC on Monday', async () => {
    await expect(
      service.remindAll(new Date('2026-06-15T08:59:00Z')),
    ).resolves.toBe(0);

    expect(slackTeamsService.findInstalledIds).not.toHaveBeenCalled();
  });

  it('reports a workspace that fails and goes on with the next', async () => {
    slackTeamsService.findInstalledIds.mockResolvedValue(['w1', 'w2']);
    slackTeamsService.claimApproverReminderWeek
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(true);

    await expect(service.remindAll(DUE)).resolves.toBe(2);

    expect(report).toHaveBeenCalledWith(expect.any(Error), {
      task: 'remind approvers',
      slackTeamId: 'w1',
    });
  });

  it('sends one DM of the time off and time entries that still wait', async () => {
    await sendJob({
      slackTeamId: 'w1',
      userId: 'u1',
      waitedBefore: TWO_DAYS_BEFORE,
    });

    expect(steps.summarizeWaitingSince).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      new Date(TWO_DAYS_BEFORE),
    );
    expect(slack.postMessage).toHaveBeenCalledWith(
      'U1',
      {
        text: [
          ':hourglass_flowing_sand: Still waiting for your decision:',
          '• 2 time off requests, the oldest since 3 Jun 2026',
          '• 14 time entries of 3 people, the oldest since 5 Jun 2026',
          "Decide them under ✅ Approvals on Logbook's Home.",
          'Change how often you are reminded: Home → 🔔 Reminders.',
        ].join('\n'),
      },
      'w1',
    );
  });

  it('sends nothing once everything was decided', async () => {
    steps.summarizeWaitingSince.mockResolvedValue({ count: 0, oldest: null });
    entries.summarizeWaitingSince.mockResolvedValue({
      count: 0,
      people: 0,
      oldest: null,
    });

    await sendJob({
      slackTeamId: 'w1',
      userId: 'u1',
      waitedBefore: TWO_DAYS_BEFORE,
    });

    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['deactivated', { is_active: false, time_reminder: TimeReminder.Weekly }],
    ['who turned reminders off', { is_active: true, time_reminder: 'off' }],
  ])('sends nothing to someone %s', async (_, user) => {
    usersService.findOne.mockResolvedValue({ id: 'u1', ...user });

    await sendJob({
      slackTeamId: 'w1',
      userId: 'u1',
      waitedBefore: TWO_DAYS_BEFORE,
    });

    expect(steps.summarizeWaitingSince).not.toHaveBeenCalled();
    expect(slack.postMessage).not.toHaveBeenCalled();
  });
});
