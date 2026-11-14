import { JobsService } from 'src/common/jobs/jobs.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import {
  NOTIFY_MOVED_JOB,
  NOTIFY_REJECTED_JOB,
  NOTIFY_SUBMITTED_JOB,
  PLAN_MOVED_JOB,
  TimeEntryNotificationsService,
} from 'src/slack/tabs/approvals/services/time-entry-notifications.service';
import { AbsenceDayCheckedEvent } from 'src/request-workflows/events/absence.events';
import { TimeEntriesSubmittedEvent } from 'src/time-entries/events/time-entries.events';
import { TimeEntriesService } from 'src/time-entries/services/time-entries.service';
import { TimeEntryApprovalsService } from 'src/time-entries/services/time-entry-approvals.service';
import { ITimeEntryViewModel } from 'src/time-entries/types/time-entry';
import { IUserViewModel } from 'src/users/types/user.interface';
import { UsersService } from 'src/users/services/users.service';

const SLACK_TEAM_ID = 'slack-team-1';

const entryOf = (id: string, owner: string) =>
  ({ id, user_id: owner, slack_team_id: SLACK_TEAM_ID }) as ITimeEntryViewModel;

// The listener runs in the transaction that submits the entries: it enqueues
// the approvers' DMs, in one statement, and runs none.
describe('TimeEntryNotificationsService', () => {
  let jobs: { enqueue: jest.Mock; enqueueMany: jest.Mock; define: jest.Mock };
  let groupByApprover: jest.Mock;
  let findMovedByAbsence: jest.Mock;
  let service: TimeEntryNotificationsService;

  beforeEach(() => {
    jobs = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
      define: jest.fn(),
    };
    groupByApprover = jest.fn();
    findMovedByAbsence = jest.fn().mockResolvedValue([]);
    service = new TimeEntryNotificationsService(
      {} as SlackCommunicationService,
      {} as TimeEntriesService,
      {
        groupByApprover,
        findMovedByAbsence,
      } as unknown as TimeEntryApprovalsService,
      {} as UsersService,
      jobs as unknown as JobsService,
    );
  });

  it('saves a job per approver and owner, leaving out whoever submitted them', async () => {
    const [mia1, mia2, sol] = [
      entryOf('e1', 'mia'),
      entryOf('e2', 'mia'),
      entryOf('e3', 'sol'),
    ];
    groupByApprover.mockResolvedValue([
      { approver: { id: 'manager' }, entries: [mia1, mia2] },
      { approver: { id: 'hr' }, entries: [mia1, sol] },
    ]);

    await service.handleSubmitted(
      new TimeEntriesSubmittedEvent([mia1, mia2, sol], SLACK_TEAM_ID, 'hr'),
    );

    expect(jobs.enqueueMany).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueMany).toHaveBeenCalledWith(NOTIFY_SUBMITTED_JOB, [
      {
        slackTeamId: SLACK_TEAM_ID,
        approverId: 'manager',
        ownerId: 'mia',
        entryIds: ['e1', 'e2'],
      },
    ]);
  });

  it("saves the owner's DM about a rejection in the caller's transaction", async () => {
    await service.notifyRejected(
      entryOf('e1', 'mia'),
      { id: 'manager', slack_team_id: SLACK_TEAM_ID } as IUserViewModel,
      'Wrong project',
    );

    expect(jobs.enqueue).toHaveBeenCalledWith(NOTIFY_REJECTED_JOB, {
      timeEntryId: 'e1',
      slackTeamId: SLACK_TEAM_ID,
      reviewerId: 'manager',
      reason: 'Wrong project',
    });
  });

  // The daily check's claim holds the workspace's row: in its transaction
  // the listener only saves the plan, which reads the entries after it.
  it('saves one plan job in the claim’s transaction and reads no entries there', async () => {
    await service.handleAbsenceDayChecked(
      new AbsenceDayCheckedEvent(SLACK_TEAM_ID, '2026-06-18'),
    );

    expect(jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(jobs.enqueue).toHaveBeenCalledWith(PLAN_MOVED_JOB, {
      slackTeamId: SLACK_TEAM_ID,
      date: '2026-06-18',
    });
    expect(findMovedByAbsence).not.toHaveBeenCalled();
    expect(jobs.enqueueMany).not.toHaveBeenCalled();
  });

  const movedToHr = [
    {
      approver: { id: 'hr' },
      groups: [
        {
          teamName: 'Design',
          away: [{ slackId: 'UMIA', until: '2026-06-24' }],
          count: 2,
        },
        {
          teamName: null,
          away: [{ slackId: 'UMIA', until: '2026-06-24' }],
          count: 1,
        },
      ],
    },
  ];

  const handlerOf = (name: string) => {
    service.onModuleInit();

    return jobs.define.mock.calls.find(
      ([jobName]) => jobName === name,
    )?.[1] as (payload: object) => Promise<void>;
  };

  it('plans the moved notices once, saving a DM job of IDs per approver', async () => {
    findMovedByAbsence.mockResolvedValue(movedToHr);

    await handlerOf(PLAN_MOVED_JOB)({
      slackTeamId: SLACK_TEAM_ID,
      date: '2026-06-18',
    });

    expect(findMovedByAbsence).toHaveBeenCalledWith(
      SLACK_TEAM_ID,
      '2026-06-18',
    );
    expect(jobs.enqueueMany).toHaveBeenCalledTimes(1);
    expect(jobs.enqueueMany).toHaveBeenCalledWith(NOTIFY_MOVED_JOB, [
      { slackTeamId: SLACK_TEAM_ID, approverId: 'hr', date: '2026-06-18' },
    ]);
  });

  describe('the moved notice', () => {
    let postMessage: jest.Mock;
    let findOne: jest.Mock;

    beforeEach(() => {
      postMessage = jest.fn().mockResolvedValue(undefined);
      findOne = jest.fn().mockResolvedValue({ id: 'hr', slack_id: 'UHR' });
      service = new TimeEntryNotificationsService(
        { postMessage } as unknown as SlackCommunicationService,
        {} as TimeEntriesService,
        {
          groupByApprover,
          findMovedByAbsence,
        } as unknown as TimeEntryApprovalsService,
        { findOne } as unknown as UsersService,
        jobs as unknown as JobsService,
      );
    });

    const send = () =>
      handlerOf(NOTIFY_MOVED_JOB)({
        slackTeamId: SLACK_TEAM_ID,
        approverId: 'hr',
        date: '2026-06-18',
      });

    it('tells what still waits for the approver when it runs', async () => {
      findMovedByAbsence.mockResolvedValue(movedToHr);

      await send();

      expect(findMovedByAbsence).toHaveBeenCalledWith(
        SLACK_TEAM_ID,
        '2026-06-18',
      );
      expect(postMessage).toHaveBeenCalledWith(
        'UHR',
        {
          text: [
            '<@UMIA> is on time off until 24 Jun 2026: 2 time entries of Design now wait for you in Approvals.',
            '<@UMIA> is on time off until 24 Jun 2026: 1 time entry of people in no team now waits for you in Approvals.',
          ].join('\n'),
        },
        SLACK_TEAM_ID,
      );
    });

    it('sends nothing once the entries were decided', async () => {
      await send();

      expect(postMessage).not.toHaveBeenCalled();
    });

    it('sends nothing to someone deactivated since', async () => {
      findOne.mockResolvedValue(null);
      findMovedByAbsence.mockResolvedValue(movedToHr);

      await send();

      expect(findMovedByAbsence).not.toHaveBeenCalled();
      expect(postMessage).not.toHaveBeenCalled();
    });
  });
});
