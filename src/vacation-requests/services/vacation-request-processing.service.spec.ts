import { VacationsUsageService } from 'src/vacation-requests/services/vacation-usage.service';
import { VacationRequestProcessingService } from 'src/vacation-requests/services/vacation-request-processing.service';
import { TeamRulesService } from 'src/teams/services/team-rules.service';
import { IEffectiveTeamRules } from 'src/teams/types/effective-team-rules.interface';
import ITeamViewModel from 'src/teams/types/team.interface';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from 'src/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from 'src/vacation-requests/types/vacation-request.interface';
import { IUserViewModel } from 'src/users/types/user.interface';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { JobsService } from 'src/common/jobs/jobs.service';
import { VacationRequestsService } from 'src/vacation-requests/services/vacation-requests.service';
import { UsersService } from 'src/users/services/users.service';
import UserRole from 'src/common/enums/user-role.enum';
import { EventEmitter2 } from '@nestjs/event-emitter';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import { TimeOffContextService } from 'src/vacation-requests/services/time-off-context.service';
import { TransactionService } from 'src/database/transaction.service';

const SLACK_TEAM_ID = 'slack-team-1';

// The rules of the requester's team, unless `fields` says otherwise.
const rules = (
  fields: Partial<IEffectiveTeamRules> = {},
): IEffectiveTeamRules => ({
  team: { id: 'team-1' } as ITeamViewModel,
  followsCompanyRules: false,
  managerApprovers: ['U_MANAGER'],
  managerApproversRule: ApprovalRule.Any,
  hrApprovers: [],
  hrApproversRule: ApprovalRule.All,
  notificationRecipients: [],
  vacationPolicyId: null,
  ...fields,
});

const buildRequest = (
  status: VacationRequestStatus,
): IVacationRequestViewModel => ({
  id: 'request-1',
  start_date: '2026-02-02',
  end_date: '2026-02-06',
  days: 5,
  working_days: 5,
  type: VacationType.AnnualLeave,
  status,
  team: { id: 'team-1', name: 'Team', slack_id: '' },
  user: {
    id: 'user-1',
    name: 'Requester',
    email: 'requester@example.com',
    slack_id: 'U_REQUESTER',
  },
  team_id: 'team-1',
  user_id: 'user-1',
  slack_team_id: SLACK_TEAM_ID,
  created_at: null,
  updated_at: null,
  updated_by: null,
  created_by: null,
});

// Runs a job as soon as it is enqueued; `done()` waits for the ones started.
// No run(): a job that follows a change is saved with it (enqueue).
const inlineJobs = () => {
  const handlers = new Map<string, (payload: object) => Promise<void>>();
  const running: Promise<void>[] = [];

  return {
    jobs: {
      define: (name: string, handler: (payload: object) => Promise<void>) =>
        handlers.set(name, handler),
      enqueue: jest.fn((name: string, payload: object) => {
        running.push(handlers.get(name)!(payload));

        return Promise.resolve();
      }),
    } as unknown as JobsService,
    done: () => Promise.all(running),
  };
};

describe('VacationRequestProcessingService', () => {
  let teamRules: { forTeam: jest.Mock };
  let workflowService: Record<'create' | 'cancel', jest.Mock>;
  let usersByRole: Partial<Record<UserRole, string[]>>;
  let eventEmitter: { emitAsync: jest.Mock };
  // Whether each emitAsync came inside a transaction.
  let emittedInTransaction: boolean[];
  let requestsService: { findOne: jest.Mock; findMany: jest.Mock };
  let usersService: { findMany: jest.Mock; findOne: jest.Mock };
  let usageService: { getVacationPeriodUsage: jest.Mock };
  let timeOffContext: { findColleaguesOff: jest.Mock };
  let jobs: ReturnType<typeof inlineJobs>;
  let service: VacationRequestProcessingService;
  let inTransaction = false;
  // What waits for the commit.
  let afterCommit: (() => Promise<unknown>)[];
  const transactions = {
    transaction: async <T>(work: () => Promise<T>) => {
      inTransaction = true;

      try {
        return await work();
      } finally {
        inTransaction = false;
      }
    },
    afterCommit: (work: () => Promise<unknown>) => afterCommit.push(work),
  };
  const commit = () => Promise.all(afterCommit.map((work) => work()));

  beforeEach(() => {
    teamRules = { forTeam: jest.fn().mockResolvedValue(rules()) };
    workflowService = { create: jest.fn(), cancel: jest.fn() };
    // The active people with an approving role.
    usersByRole = { [UserRole.Manager]: ['U_MANAGER'] };
    usersService = {
      // The requester's Slack ID stands for them: their id is user-1.
      findMany: jest.fn(async ({ roles }: { roles: UserRole[] }) =>
        roles.flatMap((role) =>
          (usersByRole[role] ?? []).map((slack_id) => ({
            id: slack_id === 'U_REQUESTER' ? 'user-1' : slack_id,
            slack_id,
            role,
          })),
        ),
      ),
      findOne: jest.fn().mockResolvedValue(null),
    };
    usageService = { getVacationPeriodUsage: jest.fn() };
    timeOffContext = { findColleaguesOff: jest.fn().mockResolvedValue([]) };
    emittedInTransaction = [];
    eventEmitter = {
      emitAsync: jest.fn(() => {
        emittedInTransaction.push(inTransaction);

        return Promise.resolve([]);
      }),
    };
    requestsService = {
      findOne: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    };
    jobs = inlineJobs();
    afterCommit = [];

    service = new VacationRequestProcessingService(
      teamRules as unknown as TeamRulesService,
      workflowService as unknown as RequestWorkflowService,
      usersService as unknown as UsersService,
      eventEmitter as unknown as EventEmitter2,
      requestsService as unknown as VacationRequestsService,
      jobs.jobs,
      usageService as unknown as VacationsUsageService,
      timeOffContext as unknown as TimeOffContextService,
      transactions as unknown as TransactionService,
    );
    service.onModuleInit();
  });

  const onCreated = async (status: VacationRequestStatus) => {
    requestsService.findOne.mockResolvedValue(buildRequest(status));
    await service.handleRequestCreated(
      new VacationRequestCreatedEvent(
        buildRequest(status),
        {} as IUserViewModel,
      ),
    );
    await jobs.done();
  };

  it('starts the approval workflow for a pending request', async () => {
    await onCreated(VacationRequestStatus.Pending);

    expect(workflowService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-1',
        levels: [
          {
            rule: ApprovalRule.Any,
            name: 'Manager approval',
            steps: [{ slackUserId: 'U_MANAGER', stepType: 'approver' }],
          },
        ],
      }),
    );
  });

  it("tells the approvers the requester's balance after it and who else is off", async () => {
    usersService.findOne.mockResolvedValue({ id: 'user-1' });
    usageService.getVacationPeriodUsage.mockResolvedValue({
      limits: { daysTotal: 20, bonusDays: 2 },
      usage: { [VacationType.AnnualLeave]: { available: 10 } },
    });
    timeOffContext.findColleaguesOff.mockResolvedValue([
      { name: 'Lea', start_date: '2026-02-01', end_date: '2026-02-03' },
    ]);

    await onCreated(VacationRequestStatus.Pending);

    expect(timeOffContext.findColleaguesOff).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'request-1' }),
      { forRequester: false },
    );
    // The balance of the vacation year the request starts in.
    expect(usageService.getVacationPeriodUsage).toHaveBeenCalledWith(
      { id: 'user-1' },
      new Date('2026-02-02'),
    );
    expect(workflowService.create.mock.calls[0][0].snapshot.context).toEqual({
      balance_after: { available: 10, total: 20, unit: 'vacation' },
      also_off: [
        { name: 'Lea', start_date: '2026-02-01', end_date: '2026-02-03' },
      ],
    });
  });

  it("tells the requester it went to their team's approvers", async () => {
    workflowService.create.mockImplementation(() => {
      expect(inTransaction).toBe(true);
    });

    await onCreated(VacationRequestStatus.Pending);

    expect(teamRules.forTeam).toHaveBeenCalledWith('team-1', SLACK_TEAM_ID);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      VacationRequestEvent.SentForApproval,
      expect.objectContaining({ fallback: null }),
    );
    // The DM's job is saved with the workflow.
    expect(emittedInTransaction).toEqual([true]);
  });

  it("saves the workflow's job in the transaction of the request", async () => {
    await onCreated(VacationRequestStatus.Pending);

    expect(jobs.jobs.enqueue).toHaveBeenCalledWith(
      'vacation-request-start-workflow',
      { requestId: 'request-1', slackTeamId: SLACK_TEAM_ID },
    );
  });

  it.each([
    VacationRequestStatus.Approved,
    VacationRequestStatus.Rejected,
    VacationRequestStatus.Canceled,
  ])(
    'does not ask anyone to approve a request created as %s',
    async (status) => {
      await onCreated(status);

      expect(teamRules.forTeam).not.toHaveBeenCalled();
      expect(workflowService.create).not.toHaveBeenCalled();
    },
  );

  // The job runs again after a failure, maybe after the request changed.
  it('asks nobody when the request is no longer pending when the job runs', async () => {
    requestsService.findOne.mockResolvedValue(
      buildRequest(VacationRequestStatus.Canceled),
    );

    await service.handleRequestCreated(
      new VacationRequestCreatedEvent(
        buildRequest(VacationRequestStatus.Pending),
        {} as IUserViewModel,
      ),
    );
    await jobs.done();

    expect(requestsService.findOne).toHaveBeenCalledWith({
      id: 'request-1',
      slackTeamId: SLACK_TEAM_ID,
    });
    expect(workflowService.create).not.toHaveBeenCalled();
  });

  it('sends the request of someone in no team to the level 2 of the company rules', async () => {
    teamRules.forTeam.mockResolvedValue(
      rules({
        team: null,
        followsCompanyRules: true,
        managerApprovers: [],
        hrApprovers: ['U_HR_1', 'U_REQUESTER'],
        hrApproversRule: ApprovalRule.All,
      }),
    );
    usersByRole = { [UserRole.HR]: ['U_HR_1', 'U_HR_2'] };

    await onCreated(VacationRequestStatus.Pending);

    expect(workflowService.create.mock.calls[0][0].levels).toEqual([
      {
        rule: ApprovalRule.All,
        name: 'HR approval',
        steps: [{ slackUserId: 'U_HR_1', stepType: 'approver' }],
      },
    ]);
    expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
      VacationRequestEvent.SentForApproval,
      expect.objectContaining({ fallback: null }),
    );
  });

  it('calls level 2 an admin approval when only admins are on it', async () => {
    teamRules.forTeam.mockResolvedValue(
      rules({ managerApprovers: [], hrApprovers: ['U_ADMIN'] }),
    );
    usersByRole = { [UserRole.Admin]: ['U_ADMIN'] };

    await onCreated(VacationRequestStatus.Pending);

    expect(workflowService.create.mock.calls[0][0].levels).toEqual([
      expect.objectContaining({ name: 'Admin approval' }),
    ]);
  });

  // Deactivated, or without an approving role since the team named them:
  // findMany doesn't return them.
  it('leaves out an approver who can no longer decide, and goes to HR', async () => {
    usersByRole = { [UserRole.HR]: ['U_HR'] };

    await onCreated(VacationRequestStatus.Pending);

    expect(workflowService.create.mock.calls[0][0].levels).toEqual([
      {
        rule: ApprovalRule.Any,
        name: 'HR approval',
        steps: [{ slackUserId: 'U_HR', stepType: 'approver' }],
      },
    ]);
  });

  describe('when nobody on the team can approve it', () => {
    const levelsOf = () => workflowService.create.mock.calls[0][0].levels;
    const sentTo = () => {
      const [event, payload] = eventEmitter.emitAsync.mock.calls[0];
      expect(event).toBe(VacationRequestEvent.SentForApproval);
      return payload.fallback.sentTo;
    };
    // One level, named by who decides it.
    const anyOf = (name: string, ...slackIds: string[]) => [
      {
        rule: ApprovalRule.Any,
        name,
        steps: slackIds.map((slackUserId) => ({
          slackUserId,
          stepType: 'approver',
        })),
      },
    ];

    beforeEach(() => {
      // The requester is the team's only approver.
      teamRules.forTeam.mockResolvedValue(
        rules({
          managerApprovers: ['U_REQUESTER'],
          managerApproversRule: ApprovalRule.All,
        }),
      );
    });

    it('sends it to anyone of HR, leaving out the requester', async () => {
      usersByRole = {
        [UserRole.HR]: ['U_HR_1', 'U_REQUESTER', 'U_HR_2'],
        [UserRole.Admin]: ['U_ADMIN'],
      };

      await onCreated(VacationRequestStatus.Pending);

      expect(levelsOf()).toEqual(anyOf('HR approval', 'U_HR_1', 'U_HR_2'));
      expect(sentTo()).toBe(UserRole.HR);
    });

    it('sends it to the admins when there is no HR', async () => {
      usersByRole = { [UserRole.Admin]: ['U_ADMIN'] };

      await onCreated(VacationRequestStatus.Pending);

      expect(levelsOf()).toEqual(anyOf('Admin approval', 'U_ADMIN'));
      expect(sentTo()).toBe(UserRole.Admin);
    });

    it('does the same for a requester in no team', async () => {
      teamRules.forTeam.mockResolvedValue(
        rules({ team: null, followsCompanyRules: true, managerApprovers: [] }),
      );
      usersByRole = { [UserRole.HR]: ['U_HR_1'] };

      await onCreated(VacationRequestStatus.Pending);

      expect(levelsOf()).toEqual(anyOf('HR approval', 'U_HR_1'));
      expect(eventEmitter.emitAsync.mock.calls[0][1].fallback).toEqual({
        inTeam: false,
        followsCompanyRules: true,
        sentTo: UserRole.HR,
      });
    });

    it('starts no workflow when nobody else can approve it', async () => {
      usersByRole = { [UserRole.Admin]: ['U_REQUESTER'] };

      await onCreated(VacationRequestStatus.Pending);

      expect(workflowService.create).not.toHaveBeenCalled();
      expect(sentTo()).toBeNull();
    });
  });

  // With the cancel, in its transaction.
  it('closes the approval workflow when a pending request is canceled', async () => {
    const requester = { id: 'user-1' } as IUserViewModel;

    await service.handleRequestUpdated(
      new VacationRequestUpdatedEvent(
        buildRequest(VacationRequestStatus.Canceled),
        requester,
        buildRequest(VacationRequestStatus.Pending),
      ),
    );

    expect(workflowService.cancel).toHaveBeenCalledWith('request-1', requester);
    expect(afterCommit).toEqual([]);
    expect(workflowService.create).not.toHaveBeenCalled();
  });

  // Nothing waits for approval then; only a race could have left a step.
  it('closes what is left of the workflow after the commit once the request no longer waited', async () => {
    const hr = { id: 'hr-1' } as IUserViewModel;

    await service.handleRequestUpdated(
      new VacationRequestUpdatedEvent(
        {
          ...buildRequest(VacationRequestStatus.Approved),
          end_date: '2026-02-09',
        },
        hr,
        buildRequest(VacationRequestStatus.Approved),
      ),
    );
    expect(workflowService.cancel).not.toHaveBeenCalled();

    await commit();

    expect(workflowService.cancel).toHaveBeenCalledWith('request-1', hr);
    expect(jobs.jobs.enqueue).not.toHaveBeenCalled();
  });

  describe('when HR edits a pending request that stays pending', () => {
    const hr = { id: 'hr-1' } as IUserViewModel;
    const pending = buildRequest(VacationRequestStatus.Pending);

    const onEdited = async (after: IVacationRequestViewModel) => {
      requestsService.findOne.mockResolvedValue(after);
      await service.handleRequestUpdated(
        new VacationRequestUpdatedEvent(after, hr, pending),
      );
      await jobs.done();
    };

    it('starts the approval again, as a new run, for new dates', async () => {
      await onEdited({ ...pending, end_date: '2026-02-09' });

      expect(workflowService.cancel).toHaveBeenCalledWith('request-1', hr);
      expect(workflowService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'request-1',
          run: expect.not.stringMatching(/^request-1$/),
        }),
      );
    });

    it('leaves the approval alone when only the comment changed', async () => {
      await onEdited({ ...pending, user_comment: 'Back on Monday' });

      expect(workflowService.cancel).not.toHaveBeenCalled();
      expect(workflowService.create).not.toHaveBeenCalled();
    });
  });
});
