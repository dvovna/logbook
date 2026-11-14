import { TimeReminder } from '@modules/users/enums/time-reminder.enum';
import { workflowLock } from 'src/database/advisory-locks';
import { ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { WorkflowStepProcessorService } from 'src/request-workflows/services/workflow-step-processor.service';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import {
  IRequestSnapshotData,
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { IUserViewModel } from 'src/users/types/user.interface';
import UserRole from 'src/common/enums/user-role.enum';
import VacationType from 'src/common/enums/vacation-type.enum';
import { VacationWorkflowEventEnum } from 'src/common/enums/vacation-workflow-event.enum';
import { RequestWorkflowStatus } from 'src/common/enums/request-workflow-status.enum';
import {
  VacationWorkflowFinished,
  VacationWorkflowLevelCompleted,
} from 'src/request-workflows/events/vacation-workflow.events';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';
import { ValidationError } from 'src/common/errors/validation.error';
import { TransactionService } from 'src/database/transaction.service';
import { UsersService } from 'src/users/services/users.service';

const SLACK_TEAM_ID = 'slack-team-1';
const REQUEST_ID = 'request-1';

const snapshot: IRequestSnapshotData = {
  user_id: 'user-1',
  slack_user_id: 'U_REQUESTER',
  user_name: 'Requester',
  user_email: 'requester@example.com',
  start_date: '2026-02-02',
  end_date: '2026-02-06',
  days: 5,
  working_days: 5,
  type: VacationType.AnnualLeave,
  comment: '',
};

const approver: IUserViewModel = {
  id: 'approver-user-1',
  email: 'approver@example.com',
  name: 'Approver',
  role: UserRole.Manager,
  is_active: true,
  team_id: null,
  slack_team_id: SLACK_TEAM_ID,
  slack_id: 'U_APPROVER',
  created_at: '2026-01-01T00:00:00Z',
  time_reminder: TimeReminder.Weekly,
};

const comments: IWorkflowStepCommentViewModel[] = [
  {
    id: 'comment-1',
    request_id: REQUEST_ID,
    slack_team_id: SLACK_TEAM_ID,
    slack_user_id: 'U_APPROVER',
    step_id: 'step-1',
    created_by: approver.id,
    comment: 'Enjoy',
    step_level: 1,
    created_at: '2026-01-01T00:00:00Z',
  },
];

const buildStep = (
  overrides: Partial<IRequestWorkflowStepViewModel> & {
    rule?: ApprovalRule;
  } = {},
): IRequestWorkflowStepViewModel => {
  const { rule = ApprovalRule.Any, ...rest } = overrides;

  return {
    id: 'step-1',
    slack_team_id: SLACK_TEAM_ID,
    request_id: REQUEST_ID,
    slack_user_id: 'U_APPROVER',
    step_level: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    step_type: WorkflowStepType.Approver,
    step_data: { snapshot, rule, status: WorkflowStepStatus.Pending },
    ...rest,
  };
};

// A step as the database has it once approved.
const decided = (
  step: IRequestWorkflowStepViewModel,
  by = step.slack_user_id,
  at = '2026-01-02T00:00:00Z',
): IRequestWorkflowStepViewModel => ({
  ...step,
  completed_at: at,
  step_data: {
    ...step.step_data,
    status: WorkflowStepStatus.Approved,
    decided_by_slack_id: by,
    decided_at: at,
  },
});

describe('RequestWorkflowService', () => {
  let stepsService: Record<
    | 'createMany'
    | 'findOneWithValidation'
    | 'findMany'
    | 'claimUnprocessed'
    | 'decide'
    | 'skip',
    jest.Mock
  >;
  let processorService: Record<
    'processSteps' | 'updateStepMessages' | 'updateDeletedStepMessages',
    jest.Mock
  >;
  let commentsService: { findMany: jest.Mock };
  let eventEmitter: { emitAsync: jest.Mock };
  let usersService: Record<
    'findBySlackId' | 'findAway' | 'findMany',
    jest.Mock
  >;
  let service: RequestWorkflowService;
  // What ran inside TransactionService.transaction().
  let inTransaction: boolean;
  const transactions = {
    lock: () => Promise.resolve(),
    lockInOrder: jest.fn(() => Promise.resolve()),
    transaction: async <T>(work: () => Promise<T>) => {
      inTransaction = true;

      try {
        return await work();
      } finally {
        inTransaction = false;
      }
    },
  };

  beforeEach(() => {
    transactions.lockInOrder.mockClear();
    stepsService = {
      createMany: jest.fn(),
      findOneWithValidation: jest.fn(),
      decide: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      claimUnprocessed: jest.fn().mockResolvedValue([]),
      skip: jest.fn(async (step: IRequestWorkflowStepViewModel) => ({
        ...step,
        completed_at: 'now',
        step_data: { ...step.step_data, status: WorkflowStepStatus.Skipped },
      })),
    };
    processorService = {
      processSteps: jest.fn(),
      updateStepMessages: jest.fn(),
      updateDeletedStepMessages: jest.fn(),
    };
    commentsService = { findMany: jest.fn().mockResolvedValue(comments) };
    eventEmitter = { emitAsync: jest.fn().mockResolvedValue([]) };
    usersService = {
      findBySlackId: jest.fn().mockResolvedValue(null),
      findAway: jest.fn().mockResolvedValue(new Map()),
      findMany: jest.fn().mockResolvedValue([]),
    };
    inTransaction = false;

    service = new RequestWorkflowService(
      stepsService as unknown as RequestWorkflowStepsService,
      processorService as unknown as WorkflowStepProcessorService,
      commentsService as unknown as RequestWorkflowStepCommentsService,
      eventEmitter as unknown as EventEmitter2,
      transactions as unknown as TransactionService,
      usersService as unknown as UsersService,
    );
  });

  const getFinishedEvent = (): VacationWorkflowFinished => {
    expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);

    const [eventName, event] = eventEmitter.emitAsync.mock.calls[0] as [
      string,
      VacationWorkflowFinished,
    ];

    expect(eventName).toBe(VacationWorkflowEventEnum.Finished);

    return event;
  };

  describe('create', () => {
    it('creates a step per approver with a level per approver group and starts level 1 only', async () => {
      const level1Step = buildStep({ id: 'step-1', step_level: 1 });
      const level2Step = buildStep({ id: 'step-2', step_level: 2 });
      stepsService.createMany.mockResolvedValue([level1Step, level2Step]);
      stepsService.claimUnprocessed.mockResolvedValue([level1Step]);

      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        run: REQUEST_ID,
        snapshot,
        levels: [
          {
            rule: ApprovalRule.Any,
            steps: [
              { slackUserId: 'U_MANAGER', stepType: WorkflowStepType.Approver },
            ],
          },
          {
            rule: ApprovalRule.All,
            steps: [
              { slackUserId: 'U_HR', stepType: WorkflowStepType.Approver },
            ],
          },
        ],
      });

      expect(stepsService.createMany).toHaveBeenCalledWith([
        {
          requestId: REQUEST_ID,
          slackUserId: 'U_MANAGER',
          stepLevel: 1,
          stepType: WorkflowStepType.Approver,
          slackTeamId: SLACK_TEAM_ID,
          stepData: {
            snapshot,
            rule: ApprovalRule.Any,
            status: WorkflowStepStatus.Pending,
            run: REQUEST_ID,
          },
        },
        {
          requestId: REQUEST_ID,
          slackUserId: 'U_HR',
          stepLevel: 2,
          stepType: WorkflowStepType.Approver,
          slackTeamId: SLACK_TEAM_ID,
          stepData: {
            snapshot,
            rule: ApprovalRule.All,
            status: WorkflowStepStatus.Pending,
            run: REQUEST_ID,
          },
        },
      ]);
      expect(stepsService.claimUnprocessed).toHaveBeenCalledWith({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        stepLevel: 1,
        completed: false,
      });
      expect(processorService.processSteps).toHaveBeenCalledWith([level1Step]);
    });

    it('does nothing when there are no approvers', async () => {
      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        run: REQUEST_ID,
        snapshot,
        levels: [],
      });

      expect(stepsService.createMany).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
    });

    const oneLevel = [
      {
        rule: ApprovalRule.Any,
        steps: [
          { slackUserId: 'U_MANAGER', stepType: WorkflowStepType.Approver },
        ],
      },
    ];

    it('makes a new run once the steps of the run before are closed', async () => {
      stepsService.findMany.mockResolvedValue([
        buildStep({ completed_at: '2026-01-02T00:00:00Z' }),
      ]);
      stepsService.createMany.mockImplementation(async (steps) =>
        steps.map(() => buildStep({ id: 'step-new' })),
      );

      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        run: 'run-2',
        snapshot,
        levels: oneLevel,
      });

      expect(stepsService.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          stepData: expect.objectContaining({ run: 'run-2' }),
        }),
      ]);
    });

    // Its run was started for a later edit and read the request since.
    it('makes no run while another one is open', async () => {
      stepsService.findMany.mockResolvedValue([
        buildStep({
          step_data: {
            snapshot,
            rule: ApprovalRule.Any,
            status: WorkflowStepStatus.Pending,
            run: 'run-3',
          },
        }),
      ]);

      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        run: 'run-2',
        snapshot,
        levels: oneLevel,
      });

      expect(stepsService.createMany).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
    });
  });

  describe('approveStep', () => {
    it('with ANY rule completes the whole level and activates the next one', async () => {
      const step = buildStep({ rule: ApprovalRule.Any });
      const approvedStep = buildStep({ id: 'step-1' });
      const otherLevelStep = buildStep({ id: 'step-1b' });
      const nextLevelStep = buildStep({
        id: 'step-2',
        slack_user_id: 'U_HR',
        step_level: 2,
      });

      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue([approvedStep, otherLevelStep]);
      stepsService.findMany.mockResolvedValue([
        decided(approvedStep),
        decided(otherLevelStep),
        nextLevelStep,
      ]);
      stepsService.claimUnprocessed.mockResolvedValue([nextLevelStep]);

      await service.approveStep(step.id, approver);

      // One statement decides the whole level.
      expect(stepsService.decide).toHaveBeenCalledTimes(1);
      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, stepLevel: 1, slackTeamId: SLACK_TEAM_ID },
        'approved',
        approver,
      );
      expect(processorService.updateStepMessages).toHaveBeenCalledWith([
        approvedStep,
        otherLevelStep,
      ]);
      const nextLevel = {
        requestId: REQUEST_ID,
        stepLevel: 2,
        slackTeamId: SLACK_TEAM_ID,
        completed: false,
      };
      expect(stepsService.findMany).toHaveBeenCalledWith({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(stepsService.claimUnprocessed).toHaveBeenCalledWith(nextLevel);
      expect(processorService.processSteps).toHaveBeenCalledWith([
        nextLevelStep,
      ]);
      // The requester hears that the level is done, with the decision.
      expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationWorkflowEventEnum.LevelCompleted,
        new VacationWorkflowLevelCompleted(REQUEST_ID, SLACK_TEAM_ID, 1, 2),
      );
    });

    it('does not ask the next level again when another approver already did', async () => {
      const step = buildStep({ rule: ApprovalRule.Any });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue([step]);
      stepsService.findMany.mockResolvedValue([
        decided(step),
        buildStep({ id: 'step-2', slack_user_id: 'U_HR', step_level: 2 }),
      ]);
      stepsService.claimUnprocessed.mockResolvedValue([]);

      await service.approveStep(step.id, approver);

      expect(processorService.processSteps).toHaveBeenCalledWith([]);
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('with ALL rule waits while other approvers of the level are pending', async () => {
      const step = buildStep({ rule: ApprovalRule.All });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue([step]);
      stepsService.findMany.mockResolvedValue([
        decided(step),
        buildStep({ id: 'step-1b', rule: ApprovalRule.All }),
      ]);

      await service.approveStep(step.id, approver);

      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, stepId: step.id, slackTeamId: SLACK_TEAM_ID },
        'approved',
        approver,
      );
      expect(processorService.updateStepMessages).toHaveBeenCalledWith([step]);
      expect(stepsService.findMany).toHaveBeenCalledWith({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('finishes the workflow as approved after the last approval of the last level', async () => {
      const step = buildStep({ step_level: 2, rule: ApprovalRule.All });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue([step]);
      stepsService.findMany.mockResolvedValue([decided(step)]);

      await service.approveStep(step.id, approver);

      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(getFinishedEvent().workflow).toEqual({
        requestId: REQUEST_ID,
        status: RequestWorkflowStatus.Approved,
        slackTeamId: SLACK_TEAM_ID,
        approvedBy: approver.id,
        reviewComments: comments,
      });
    });

    // A decision never stays without what follows it: the messages to
    // refresh and the request to finish are saved with it, as jobs.
    it('decides, refreshes the messages and finishes in one transaction', async () => {
      const step = buildStep({ step_level: 2, rule: ApprovalRule.Any });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.findMany.mockResolvedValue([decided(step)]);
      const calls: string[] = [];
      const record = (call: string) => () => {
        calls.push(`${call}, in a transaction: ${inTransaction}`);

        return Promise.resolve([step]);
      };
      stepsService.decide.mockImplementation(record('decide'));
      processorService.updateStepMessages.mockImplementation(
        record('refresh messages'),
      );
      eventEmitter.emitAsync.mockImplementation(record('finish'));

      await service.approveStep(step.id, approver);

      expect(calls).toEqual([
        'decide, in a transaction: true',
        'refresh messages, in a transaction: true',
        'finish, in a transaction: true',
      ]);
    });
  });

  describe('approveCurrentLevel', () => {
    const hr = { ...approver, id: 'hr-1', slack_id: 'U_HR', role: UserRole.HR };

    it('approves every open step of the lowest open level and activates the next one', async () => {
      const level1 = [
        buildStep({ id: 'step-1', rule: ApprovalRule.All }),
        buildStep({ id: 'step-1b', rule: ApprovalRule.All }),
      ];
      const level2 = [
        buildStep({ id: 'step-2', slack_user_id: 'U_HR_2', step_level: 2 }),
      ];
      stepsService.findMany
        .mockResolvedValueOnce([...level1, ...level2])
        .mockResolvedValueOnce([
          ...level1.map((step) => decided(step, hr.slack_id)),
          ...level2,
        ]);
      stepsService.claimUnprocessed.mockResolvedValue(level2);
      stepsService.decide.mockResolvedValue(level1);

      await service.approveCurrentLevel(REQUEST_ID, hr);

      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, stepLevel: 1, slackTeamId: SLACK_TEAM_ID },
        RequestWorkflowStatus.Approved,
        hr,
      );
      expect(processorService.updateStepMessages).toHaveBeenCalledWith(level1);
      expect(processorService.processSteps).toHaveBeenCalledWith(level2);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationWorkflowEventEnum.LevelCompleted,
        new VacationWorkflowLevelCompleted(REQUEST_ID, SLACK_TEAM_ID, 1, 2),
      );
    });

    it('finishes the workflow as approved when it was the last level', async () => {
      const level2 = [buildStep({ id: 'step-2', step_level: 2 })];
      stepsService.findMany
        .mockResolvedValueOnce(level2)
        .mockResolvedValueOnce(level2.map((step) => decided(step)));
      stepsService.decide.mockResolvedValue(level2);

      await service.approveCurrentLevel(REQUEST_ID, hr);

      expect(getFinishedEvent().workflow).toMatchObject({
        requestId: REQUEST_ID,
        status: RequestWorkflowStatus.Approved,
        approvedBy: hr.id,
      });
    });

    it('refuses when nobody has to approve the request', async () => {
      stepsService.findMany.mockResolvedValue([]);

      await expect(service.approveCurrentLevel(REQUEST_ID, hr)).rejects.toThrow(
        ValidationError,
      );
      expect(stepsService.decide).not.toHaveBeenCalled();
    });

    it('stops when an approver decided the level in the meantime', async () => {
      stepsService.findMany.mockResolvedValue([buildStep({ id: 'step-1' })]);
      stepsService.decide.mockResolvedValue([]);

      await service.approveCurrentLevel(REQUEST_ID, hr);

      expect(stepsService.claimUnprocessed).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('is only for HR and admins', async () => {
      stepsService.findMany.mockResolvedValue([buildStep({ id: 'step-1' })]);

      await expect(
        service.approveCurrentLevel(REQUEST_ID, approver),
      ).rejects.toThrow(ForbiddenException);
      expect(stepsService.decide).not.toHaveBeenCalled();
    });
  });

  describe('approvers on time off', () => {
    const awayManager = new Map([
      [
        'U_MANAGER',
        { userId: 'manager-1', since: '2026-06-15', until: '2026-06-24' },
      ],
    ]);
    const managerStep = buildStep({
      id: 'step-manager',
      slack_user_id: 'U_MANAGER',
    });
    const hrStep = buildStep({
      id: 'step-hr',
      slack_user_id: 'U_HR',
      step_level: 2,
    });
    const skippedStep = (step: IRequestWorkflowStepViewModel) => ({
      ...step,
      completed_at: 'now',
      step_data: { ...step.step_data, status: WorkflowStepStatus.Skipped },
    });
    const twoLevels = [
      {
        rule: ApprovalRule.Any,
        steps: [
          { slackUserId: 'U_MANAGER', stepType: WorkflowStepType.Approver },
        ],
      },
      {
        rule: ApprovalRule.Any,
        steps: [{ slackUserId: 'U_HR', stepType: WorkflowStepType.Approver }],
      },
    ];

    it('skips an away manager when the request is made and asks the HR level', async () => {
      usersService.findAway.mockResolvedValue(awayManager);
      stepsService.createMany.mockResolvedValue([managerStep, hrStep]);
      stepsService.claimUnprocessed.mockResolvedValue([hrStep]);

      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        run: REQUEST_ID,
        snapshot,
        levels: twoLevels,
      });

      expect(stepsService.skip).toHaveBeenCalledWith(managerStep, '2026-06-24');
      expect(stepsService.claimUnprocessed).toHaveBeenCalledWith(
        expect.objectContaining({ stepLevel: 2, completed: false }),
      );
      expect(processorService.processSteps).toHaveBeenCalledWith([hrStep]);
      expect(processorService.updateStepMessages).toHaveBeenCalledWith([
        skippedStep(managerStep),
      ]);
      // The sent-for-approval notice tells the requester of a new request.
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('create retried after a skip asks nobody new', async () => {
      usersService.findAway.mockResolvedValue(awayManager);
      stepsService.findMany.mockResolvedValue([
        skippedStep(managerStep),
        hrStep,
      ]);

      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        run: REQUEST_ID,
        snapshot,
        levels: twoLevels,
      });

      expect(stepsService.createMany).not.toHaveBeenCalled();
      expect(processorService.processSteps).toHaveBeenCalledWith([hrStep]);
    });

    it('skipAway does nothing for a request with no open steps', async () => {
      usersService.findAway.mockResolvedValue(awayManager);
      stepsService.findMany.mockResolvedValue([decided(managerStep)]);

      await service.skipAway(REQUEST_ID, SLACK_TEAM_ID);

      expect(stepsService.skip).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('skipAway tells the requester when it asks someone new', async () => {
      usersService.findAway.mockResolvedValue(awayManager);
      stepsService.findMany.mockResolvedValue([
        { ...managerStep, processed_at: '2026-01-01T00:00:00Z' },
        hrStep,
      ]);
      stepsService.claimUnprocessed.mockResolvedValue([hrStep]);

      await service.skipAway(REQUEST_ID, SLACK_TEAM_ID);

      expect(stepsService.skip).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'step-manager' }),
        '2026-06-24',
      );
      expect(processorService.processSteps).toHaveBeenCalledWith([hrStep]);
      expect(eventEmitter.emitAsync).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emitAsync).toHaveBeenCalledWith(
        VacationWorkflowEventEnum.LevelCompleted,
        new VacationWorkflowLevelCompleted(REQUEST_ID, SLACK_TEAM_ID, 1, 2, [
          'step-manager',
        ]),
      );
    });

    it('skipAway adds a fallback level above the highest when the last level is skipped', async () => {
      const awayHr = {
        ...approver,
        id: 'hr-1',
        slack_id: 'U_HR',
        role: UserRole.HR,
      };
      const admin = {
        ...approver,
        id: 'admin-1',
        slack_id: 'U_ADMIN',
        role: UserRole.Admin,
      };
      usersService.findAway.mockResolvedValue(
        new Map([
          [
            'U_HR',
            { userId: 'hr-1', since: '2026-06-15', until: '2026-06-24' },
          ],
        ]),
      );
      usersService.findMany.mockResolvedValue([awayHr, admin]);
      stepsService.findMany.mockResolvedValue([
        decided(buildStep({ id: 'step-1' })),
        hrStep,
      ]);
      const adminStep = buildStep({
        id: 'step-admin',
        slack_user_id: 'U_ADMIN',
        step_level: 3,
      });
      stepsService.createMany.mockResolvedValue([adminStep]);
      stepsService.claimUnprocessed.mockResolvedValue([adminStep]);

      await service.skipAway(REQUEST_ID, SLACK_TEAM_ID);

      expect(stepsService.skip).toHaveBeenCalledWith(hrStep, '2026-06-24');
      expect(stepsService.createMany).toHaveBeenCalledWith([
        {
          requestId: REQUEST_ID,
          slackUserId: 'U_ADMIN',
          stepLevel: 3,
          stepType: WorkflowStepType.Approver,
          slackTeamId: SLACK_TEAM_ID,
          stepData: expect.objectContaining({
            rule: ApprovalRule.Any,
            level_name: 'Admin approval',
            status: WorkflowStepStatus.Pending,
            run: REQUEST_ID,
          }),
        },
      ]);
      expect(stepsService.claimUnprocessed).toHaveBeenCalledWith(
        expect.objectContaining({ stepLevel: 3 }),
      );
      expect(processorService.processSteps).toHaveBeenCalledWith([adminStep]);
      expect(eventEmitter.emitAsync).not.toHaveBeenCalledWith(
        VacationWorkflowEventEnum.Finished,
        expect.anything(),
      );
    });

    it('skipAway approves with the latest approval when the rest of the last level is away', async () => {
      usersService.findAway.mockResolvedValue(
        new Map([
          [
            'U_A',
            { userId: 'user-a', since: '2026-06-15', until: '2026-06-24' },
          ],
        ]),
      );
      usersService.findBySlackId.mockResolvedValue({
        ...approver,
        id: 'user-b',
        slack_id: 'U_B',
      });
      stepsService.findMany.mockResolvedValue([
        decided(
          buildStep({
            id: 'step-b',
            slack_user_id: 'U_B',
            rule: ApprovalRule.All,
          }),
        ),
        buildStep({
          id: 'step-a',
          slack_user_id: 'U_A',
          rule: ApprovalRule.All,
        }),
      ]);

      await service.skipAway(REQUEST_ID, SLACK_TEAM_ID);

      expect(usersService.findBySlackId).toHaveBeenCalledWith(
        'U_B',
        SLACK_TEAM_ID,
      );
      expect(getFinishedEvent().workflow).toEqual({
        requestId: REQUEST_ID,
        status: RequestWorkflowStatus.Approved,
        slackTeamId: SLACK_TEAM_ID,
        approvedBy: 'user-b',
        reviewComments: comments,
      });
    });

    // A rejection is finished by its own job, which closes the later levels.
    it('skipAway leaves a rejected run alone', async () => {
      usersService.findAway.mockResolvedValue(awayManager);
      stepsService.findMany.mockResolvedValue([
        {
          ...managerStep,
          completed_at: '2026-01-02T00:00:00Z',
          step_data: {
            ...managerStep.step_data,
            status: WorkflowStepStatus.Rejected,
          },
        },
        { ...hrStep, slack_user_id: 'U_MANAGER' },
      ]);

      await service.skipAway(REQUEST_ID, SLACK_TEAM_ID);

      expect(stepsService.skip).not.toHaveBeenCalled();
      expect(stepsService.createMany).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('dropApprover', () => {
    const gone = { ...approver, slack_id: 'U_MANAGER', role: UserRole.Member };
    const managerStep = buildStep({
      id: 'step-manager',
      slack_user_id: 'U_MANAGER',
      processed_at: '2026-01-01T00:00:00Z',
    });
    const canceledManagerStep = {
      ...managerStep,
      completed_at: '2026-01-02T00:00:00Z',
      step_data: {
        ...managerStep.step_data,
        status: WorkflowStepStatus.Cancelled,
      },
    };
    const awayHr = {
      ...approver,
      id: 'hr-1',
      slack_id: 'U_HR',
      role: UserRole.HR,
    };

    beforeEach(() => {
      stepsService.findMany
        .mockResolvedValueOnce([managerStep])
        .mockResolvedValueOnce([canceledManagerStep]);
      stepsService.decide.mockResolvedValue([canceledManagerStep]);
    });

    // Nobody at work could take it, and nobody is left on the run: the
    // request would wait with nobody asked.
    it('falls back to HR above the highest level, away or not, when it empties the last level', async () => {
      usersService.findAway.mockResolvedValue(
        new Map([
          [
            'U_HR',
            { userId: 'hr-1', since: '2026-06-15', until: '2026-06-24' },
          ],
        ]),
      );
      usersService.findMany.mockResolvedValue([awayHr]);
      const hrFallback = buildStep({
        id: 'step-hr',
        slack_user_id: 'U_HR',
        step_level: 2,
      });
      stepsService.createMany.mockResolvedValue([hrFallback]);
      stepsService.claimUnprocessed.mockResolvedValue([hrFallback]);

      await service.dropApprover(REQUEST_ID, SLACK_TEAM_ID, gone);

      expect(processorService.updateStepMessages).toHaveBeenCalledWith([
        canceledManagerStep,
      ]);
      expect(stepsService.createMany).toHaveBeenCalledWith([
        expect.objectContaining({
          slackUserId: 'U_HR',
          stepLevel: 2,
          stepData: expect.objectContaining({ level_name: 'HR approval' }),
        }),
      ]);
      expect(processorService.processSteps).toHaveBeenCalledWith([hrFallback]);
      expect(stepsService.skip).not.toHaveBeenCalled();
    });

    it('asks nobody when nobody is left who can approve', async () => {
      await service.dropApprover(REQUEST_ID, SLACK_TEAM_ID, gone);

      expect(stepsService.createMany).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('rejectStep', () => {
    it('rejects every step of the level and finishes the workflow as rejected', async () => {
      const step = buildStep({ step_level: 1 });
      const rejectedSteps = [step, buildStep({ id: 'step-1b' })];
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue(rejectedSteps);

      await service.rejectStep(step.id, approver, '  Release week ');

      // The reason goes with the steps, for the approvers' messages.
      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, stepLevel: 1, slackTeamId: SLACK_TEAM_ID },
        'rejected',
        approver,
        'Release week',
      );
      expect(processorService.updateStepMessages).toHaveBeenCalledWith(
        rejectedSteps,
      );
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(getFinishedEvent().workflow).toEqual({
        requestId: REQUEST_ID,
        status: RequestWorkflowStatus.Rejected,
        slackTeamId: SLACK_TEAM_ID,
        approvedBy: approver.id,
        reviewComments: comments,
        rejectionReason: 'Release week',
      });
    });

    it("passes the approver's reason on with the finished workflow", async () => {
      const step = buildStep({ step_level: 1 });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue([step]);

      await service.rejectStep(step.id, approver, '  Release week  ');

      expect(getFinishedEvent().workflow.rejectionReason).toBe('Release week');
    });

    // The database keeps at most 300; a longer one would fail the job that
    // finishes the request and leave it pending with its steps rejected.
    it('refuses a reason over 300 characters', async () => {
      const step = buildStep({ step_level: 1 });
      stepsService.findOneWithValidation.mockResolvedValue(step);

      const error: unknown = await service
        .rejectStep(step.id, approver, 'x'.repeat(301))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ValidationError);
      expect(error).toMatchObject({ field: 'reason' });
      expect(stepsService.decide).not.toHaveBeenCalled();
    });

    it('refuses HR rejecting their own request', async () => {
      const hr = {
        ...approver,
        id: snapshot.user_id,
        slack_id: 'U_HR',
        role: UserRole.HR,
      };
      const step = buildStep({ step_level: 1 });
      stepsService.findOneWithValidation.mockResolvedValue(step);

      await expect(service.rejectStep(step.id, hr)).rejects.toThrow(
        ValidationError,
      );
      expect(stepsService.decide).not.toHaveBeenCalled();
    });
  });

  describe('a step that is already decided', () => {
    const decidedStep = (status: WorkflowStepStatus) => {
      const step = buildStep();

      return { ...step, step_data: { ...step.step_data, status } };
    };

    it.each([
      WorkflowStepStatus.Approved,
      WorkflowStepStatus.Rejected,
      WorkflowStepStatus.Cancelled,
    ])('ignores Approve when the step is %s', async (status) => {
      stepsService.findOneWithValidation.mockResolvedValue(decidedStep(status));

      await service.approveStep('step-1', approver);

      expect(stepsService.decide).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    // Two approvers click at the same moment: the step was open when read,
    // but the other one's decision closed it first.
    it('stops when another approver decided the step first', async () => {
      const step = buildStep({ rule: ApprovalRule.Any });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.decide.mockResolvedValue([]);

      await service.approveStep(step.id, approver);
      await service.rejectStep(step.id, approver);

      expect(stepsService.claimUnprocessed).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('ignores Reject when the step is canceled', async () => {
      stepsService.findOneWithValidation.mockResolvedValue(
        decidedStep(WorkflowStepStatus.Cancelled),
      );

      await service.rejectStep('step-1', approver);

      expect(stepsService.decide).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const requester = { ...approver, id: 'requester-1', slack_id: 'U_REQ' };

    it('marks every open step as canceled and closes their messages', async () => {
      const openSteps = [
        buildStep({ id: 'step-1' }),
        buildStep({ id: 'step-2', step_level: 2 }),
      ];
      stepsService.decide.mockResolvedValue(openSteps);

      await service.cancel(REQUEST_ID, requester);

      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, slackTeamId: SLACK_TEAM_ID },
        RequestWorkflowStatus.Canceled,
        requester,
      );
      expect(processorService.updateStepMessages).toHaveBeenCalledWith(
        openSteps,
      );
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    it('does nothing when the request has no open steps', async () => {
      stepsService.decide.mockResolvedValue([]);

      await service.cancel(REQUEST_ID, requester);

      expect(processorService.updateStepMessages).not.toHaveBeenCalled();
    });
  });

  describe('closeBeforeDelete', () => {
    const admin = { ...approver, id: 'admin-1', slack_id: 'U_ADMIN' };

    it('closes every open step and their messages from what it read', async () => {
      const openSteps = [
        buildStep({ id: 'step-1' }),
        buildStep({ id: 'step-2', step_level: 2 }),
      ];
      stepsService.decide.mockResolvedValue(openSteps);

      await service.closeBeforeDelete(REQUEST_ID, admin);

      expect(transactions.lockInOrder).toHaveBeenCalledWith(
        workflowLock(REQUEST_ID),
      );
      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: [REQUEST_ID], slackTeamId: SLACK_TEAM_ID },
        RequestWorkflowStatus.Canceled,
        admin,
      );
      expect(commentsService.findMany).toHaveBeenCalledWith({
        requestIds: [REQUEST_ID],
        slackTeamId: SLACK_TEAM_ID,
      });
      expect(processorService.updateDeletedStepMessages).toHaveBeenCalledWith(
        openSteps,
        comments,
      );
      expect(processorService.updateStepMessages).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emitAsync).not.toHaveBeenCalled();
    });

    // The jobs are saved with the closed steps, and start once the delete
    // that the caller runs in the same transaction has committed.
    it('closes the steps and saves the jobs in one transaction', async () => {
      const calls: string[] = [];
      const record = (call: string) => () => {
        calls.push(`${call}, in a transaction: ${inTransaction}`);

        return Promise.resolve([buildStep()]);
      };
      stepsService.decide.mockImplementation(record('decide'));
      processorService.updateDeletedStepMessages.mockImplementation(
        record('save the jobs'),
      );

      await service.closeBeforeDelete(REQUEST_ID, admin);

      expect(calls).toEqual([
        'decide, in a transaction: true',
        'save the jobs, in a transaction: true',
      ]);
    });

    it('closes several requests with the same statements as one', async () => {
      const steps = [
        buildStep({ id: 'step-1' }),
        buildStep({ id: 'step-2', request_id: 'request-2' }),
      ];
      stepsService.decide.mockResolvedValue(steps);

      await service.closeManyBeforeDelete([REQUEST_ID, 'request-2'], admin);

      expect(transactions.lockInOrder).toHaveBeenCalledTimes(1);
      expect(transactions.lockInOrder).toHaveBeenCalledWith(
        workflowLock(REQUEST_ID),
        workflowLock('request-2'),
      );
      expect(stepsService.decide).toHaveBeenCalledTimes(1);
      expect(stepsService.decide).toHaveBeenCalledWith(
        { requestId: [REQUEST_ID, 'request-2'], slackTeamId: SLACK_TEAM_ID },
        RequestWorkflowStatus.Canceled,
        admin,
      );
      expect(commentsService.findMany).toHaveBeenCalledTimes(1);
      expect(processorService.updateDeletedStepMessages).toHaveBeenCalledWith(
        steps,
        comments,
      );
    });

    it('does nothing without requests', async () => {
      await service.closeManyBeforeDelete([], admin);

      expect(transactions.lockInOrder).not.toHaveBeenCalled();
      expect(stepsService.decide).not.toHaveBeenCalled();
    });
  });
});
