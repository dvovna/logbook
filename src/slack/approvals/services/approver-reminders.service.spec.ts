import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import UserRole from '@common/enums/user-role.enum';
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
const FIVE_DAYS_BEFORE = '2026-06-10T09:05:00.000Z';

describe('ApproverRemindersService', () => {
  let service: ApproverRemindersService;
  let slackTeamsService: {
    findApproverRemindersDue: jest.Mock;
    claimApproverReminderWeek: jest.Mock;
    claimApproverReminderDay: jest.Mock;
  };
  let usersService: {
    findActiveWithReminder: jest.Mock;
    findOne: jest.Mock;
    findMany: jest.Mock;
    findAway: jest.Mock;
  };
  let steps: {
    findApproversWaitingSince: jest.Mock;
    summarizeWaitingSince: jest.Mock;
    findStuckSince: jest.Mock;
  };
  let entries: {
    findApproversWaitingSince: jest.Mock;
    summarizeWaitingSince: jest.Mock;
    findStuckSince: jest.Mock;
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
      findApproverRemindersDue: jest
        .fn()
        .mockResolvedValue([{ id: 'w1', week: true, day: false }]),
      claimApproverReminderWeek: jest.fn().mockResolvedValue(true),
      claimApproverReminderDay: jest.fn().mockResolvedValue(true),
    };
    usersService = {
      findActiveWithReminder: jest.fn().mockResolvedValue([
        { id: 'u1', time_reminder: TimeReminder.Weekly },
        { id: 'u2', time_reminder: TimeReminder.Weekly },
      ]),
      findOne: jest.fn().mockResolvedValue({
        id: 'u1',
        slack_id: 'U1',
        is_active: true,
        role: UserRole.Manager,
        time_reminder: TimeReminder.Weekly,
      }),
      findMany: jest.fn().mockResolvedValue([{ id: 'hr1', role: UserRole.HR }]),
      findAway: jest.fn().mockResolvedValue(new Map()),
    };
    steps = {
      findApproversWaitingSince: jest.fn().mockResolvedValue(['U2']),
      summarizeWaitingSince: jest
        .fn()
        .mockResolvedValue({ count: 2, oldest: '2026-06-03T10:00:00.000Z' }),
      findStuckSince: jest.fn().mockResolvedValue([]),
    };
    entries = {
      findApproversWaitingSince: jest.fn().mockResolvedValue(['u1']),
      summarizeWaitingSince: jest.fn().mockResolvedValue({
        count: 14,
        people: 3,
        oldest: '2026-06-05T08:00:00.000Z',
      }),
      findStuckSince: jest.fn().mockResolvedValue([]),
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

    expect(slackTeamsService.findApproverRemindersDue).toHaveBeenCalledWith(
      MONDAY,
      MONDAY,
    );
    expect(slackTeamsService.claimApproverReminderWeek).toHaveBeenCalledWith(
      'w1',
      MONDAY,
    );
    expect(slackTeamsService.claimApproverReminderDay).not.toHaveBeenCalled();
    const before = new Date(TWO_DAYS_BEFORE);
    expect(entries.findApproversWaitingSince).toHaveBeenCalledWith(
      'w1',
      before,
    );
    expect(steps.findApproversWaitingSince).toHaveBeenCalledWith('w1', before);
    expect(usersService.findActiveWithReminder).toHaveBeenCalledWith(
      'w1',
      { ids: ['u1', 'hr1'], slackIds: ['U2'] },
      [TimeReminder.Weekly],
    );
    expect(jobs.enqueueMany).toHaveBeenCalledWith(
      REMIND_APPROVER_JOB,
      [
        {
          slackTeamId: 'w1',
          userId: 'u1',
          waitedBefore: TWO_DAYS_BEFORE,
          stuckBefore: FIVE_DAYS_BEFORE,
        },
        {
          slackTeamId: 'w1',
          userId: 'u2',
          waitedBefore: TWO_DAYS_BEFORE,
          stuckBefore: FIVE_DAYS_BEFORE,
        },
      ],
      { perSecond: 5 },
    );
  });

  it('saves nothing when another process claimed the week meanwhile', async () => {
    slackTeamsService.claimApproverReminderWeek.mockResolvedValue(false);

    await expect(service.remindAll(DUE)).resolves.toBe(0);

    expect(jobs.enqueueMany).not.toHaveBeenCalled();
  });

  it('reads nothing more once the week and the day went out', async () => {
    slackTeamsService.findApproverRemindersDue.mockResolvedValue([]);

    await expect(service.remindAll(DUE)).resolves.toBe(0);

    expect(entries.findApproversWaitingSince).not.toHaveBeenCalled();
    expect(steps.findApproversWaitingSince).not.toHaveBeenCalled();
    expect(usersService.findMany).not.toHaveBeenCalled();
  });

  it('reminds the daily ones on a working day', async () => {
    slackTeamsService.findApproverRemindersDue.mockResolvedValue([
      { id: 'w1', week: false, day: true },
    ]);
    usersService.findActiveWithReminder.mockResolvedValue([
      { id: 'u1', time_reminder: TimeReminder.Daily },
    ]);
    const wednesday = new Date('2026-06-17T09:30:00Z');

    await expect(service.remindAll(wednesday)).resolves.toBe(1);

    expect(slackTeamsService.findApproverRemindersDue).toHaveBeenCalledWith(
      MONDAY,
      '2026-06-17',
    );
    expect(slackTeamsService.claimApproverReminderWeek).not.toHaveBeenCalled();
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

  it("reads once for Monday's week and day, and gives each its own people", async () => {
    slackTeamsService.findApproverRemindersDue.mockResolvedValue([
      { id: 'w1', week: true, day: true },
    ]);
    usersService.findActiveWithReminder.mockResolvedValue([
      { id: 'u1', time_reminder: TimeReminder.Weekly },
      { id: 'u2', time_reminder: TimeReminder.Daily },
    ]);

    await expect(service.remindAll(DUE)).resolves.toBe(2);

    expect(entries.findApproversWaitingSince).toHaveBeenCalledTimes(1);
    expect(steps.findApproversWaitingSince).toHaveBeenCalledTimes(1);
    expect(usersService.findActiveWithReminder).toHaveBeenCalledWith(
      'w1',
      expect.anything(),
      [TimeReminder.Weekly, TimeReminder.Daily],
    );
    expect(
      jobs.enqueueMany.mock.calls.map(([, payloads]) =>
        (payloads as { userId: string }[]).map(({ userId }) => userId),
      ),
    ).toEqual([['u1'], ['u2']]);
  });

  it('does nothing before 09:00 UTC on Monday', async () => {
    await expect(
      service.remindAll(new Date('2026-06-15T08:59:00Z')),
    ).resolves.toBe(0);

    expect(slackTeamsService.findApproverRemindersDue).not.toHaveBeenCalled();
  });

  it('reports a workspace that fails and goes on with the next', async () => {
    slackTeamsService.findApproverRemindersDue.mockResolvedValue([
      { id: 'w1', week: true, day: false },
      { id: 'w2', week: true, day: false },
    ]);
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
      stuckBefore: FIVE_DAYS_BEFORE,
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
      stuckBefore: FIVE_DAYS_BEFORE,
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
      stuckBefore: FIVE_DAYS_BEFORE,
    });

    expect(steps.summarizeWaitingSince).not.toHaveBeenCalled();
    expect(slack.postMessage).not.toHaveBeenCalled();
  });

  describe('for HR', () => {
    const hr = {
      id: 'hr1',
      slack_id: 'UHR',
      slack_team_id: 'w1',
      is_active: true,
      role: UserRole.HR,
      time_reminder: TimeReminder.Weekly,
    };
    const step = (fields: object) => ({
      request_id: 'r1',
      start_date: '2026-07-06',
      end_date: '2026-07-07',
      requester_id: 'mia',
      requester_name: 'Mia',
      requester_email: null,
      approver_slack_id: 'UMAX',
      approver_name: 'Max',
      approver_email: null,
      asked_at: '2026-06-08T09:00:00.000Z',
      ...fields,
    });
    const group = (fields: object) => ({
      team_id: 't1',
      owner_id: 'lou',
      owner_name: 'Lou',
      owner_email: null,
      entries: 3,
      minutes: 300,
      oldest: '2026-06-05T09:00:00.000Z',
      approver_id: 'max',
      approver_name: 'Max',
      approver_email: null,
      ...fields,
    });

    beforeEach(() => {
      usersService.findOne.mockResolvedValue(hr);
      steps.summarizeWaitingSince.mockResolvedValue({ count: 0, oldest: null });
      entries.summarizeWaitingSince.mockResolvedValue({
        count: 0,
        people: 0,
        oldest: null,
      });
    });

    const send = () =>
      sendJob({
        slackTeamId: 'w1',
        userId: 'hr1',
        waitedBefore: TWO_DAYS_BEFORE,
        stuckBefore: FIVE_DAYS_BEFORE,
      });

    it('lists what has waited for others five days, oldest first, each request and each person once', async () => {
      steps.findStuckSince.mockResolvedValue([
        step({}),
        step({ approver_slack_id: 'UANN', approver_name: 'Ann' }),
      ]);
      entries.findStuckSince.mockResolvedValue([
        group({}),
        group({ approver_id: 'ann', approver_name: 'Ann' }),
        group({ team_id: null, entries: 1, minutes: 60 }),
      ]);

      await send();

      expect(steps.findStuckSince).toHaveBeenCalledWith(
        'w1',
        new Date(FIVE_DAYS_BEFORE),
      );
      expect(slack.postMessage).toHaveBeenCalledWith(
        'UHR',
        {
          text: [
            ':rotating_light: Waiting for someone else for more than 5 days:',
            '• *Lou*: 4 time entries (6h), waiting for Ann, Max since 5 Jun 2026',
            '• *Mia*: time off 6–7 Jul 2026, waiting for Ann, Max since 8 Jun 2026',
            'You can decide them for the approvers under ✅ Approvals → All pending requests and All pending entries.',
            'Change how often you are reminded: Home → 🔔 Reminders.',
          ].join('\n'),
        },
        'w1',
      );
    });

    it('leaves out what waits for them or is their own', async () => {
      steps.findStuckSince.mockResolvedValue([
        step({ approver_slack_id: 'UHR' }),
        step({ request_id: 'r2', requester_id: 'hr1' }),
      ]);
      entries.findStuckSince.mockResolvedValue([
        group({ approver_id: 'hr1' }),
        group({ owner_id: 'hr1' }),
      ]);

      await send();

      expect(slack.postMessage).not.toHaveBeenCalled();
    });

    it('lists ten and counts the rest', async () => {
      steps.findStuckSince.mockResolvedValue(
        Array.from({ length: 12 }, (_, index) =>
          step({ request_id: `r${index}` }),
        ),
      );

      await send();

      const text = slack.postMessage.mock.calls[0][1].text as string;
      expect(
        text.split('\n').filter((line) => line.startsWith('•')),
      ).toHaveLength(10);
      expect(text).toContain('…and 2 more');
    });

    it('lists nothing to an admin while someone has the HR role', async () => {
      usersService.findOne.mockResolvedValue({
        ...hr,
        id: 'a1',
        role: UserRole.Admin,
      });
      steps.findStuckSince.mockResolvedValue([step({})]);

      await send();

      expect(slack.postMessage).not.toHaveBeenCalled();
    });

    it('reads what is stuck once for the jobs of one run', async () => {
      steps.findStuckSince.mockResolvedValue([step({})]);
      usersService.findMany.mockResolvedValue([
        { id: 'hr1', role: UserRole.HR },
        { id: 'hr2', role: UserRole.HR },
      ]);

      await send();
      usersService.findOne.mockResolvedValue({
        ...hr,
        id: 'hr2',
        slack_id: 'UHR2',
      });
      await send();

      expect(slack.postMessage).toHaveBeenCalledTimes(2);
      expect(steps.findStuckSince).toHaveBeenCalledTimes(1);
      expect(usersService.findMany).toHaveBeenCalledTimes(1);

      // A retry minutes later reads again.
      jest.advanceTimersByTime(2 * 60 * 1000);
      await send();

      expect(steps.findStuckSince).toHaveBeenCalledTimes(2);
    });

    it('lists nothing to a manager', async () => {
      usersService.findOne.mockResolvedValue({ ...hr, role: UserRole.Manager });

      await send();

      expect(steps.findStuckSince).not.toHaveBeenCalled();
    });
  });
});
