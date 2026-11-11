import { JobsService } from 'src/common/jobs/jobs.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import {
  NOTIFY_REJECTED_JOB,
  NOTIFY_SUBMITTED_JOB,
  TimeEntryNotificationsService,
} from 'src/slack/tabs/approvals/services/time-entry-notifications.service';
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
  let jobs: { enqueue: jest.Mock; enqueueMany: jest.Mock };
  let groupByApprover: jest.Mock;
  let service: TimeEntryNotificationsService;

  beforeEach(() => {
    jobs = {
      enqueue: jest.fn().mockResolvedValue(undefined),
      enqueueMany: jest.fn().mockResolvedValue(undefined),
    };
    groupByApprover = jest.fn();
    service = new TimeEntryNotificationsService(
      {} as SlackCommunicationService,
      {} as TimeEntriesService,
      { groupByApprover } as unknown as TimeEntryApprovalsService,
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
});
