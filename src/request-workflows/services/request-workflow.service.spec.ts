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
import { VacationWorkflowFinished } from 'src/common/events/vacation-workflow.events';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';
import { ValidationError } from 'src/common/errors/validation.error';

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

describe('RequestWorkflowService', () => {
  let stepsService: Record<
    | 'createMany'
    | 'findOneWithValidation'
    | 'updateStatus'
    | 'findMany'
    | 'count'
    | 'claimUnprocessed',
    jest.Mock
  >;
  let processorService: Record<
    'processSteps' | 'completeSteps' | 'updateStepMessages',
    jest.Mock
  >;
  let commentsService: { findMany: jest.Mock };
  let eventEmitter: { emit: jest.Mock };
  let service: RequestWorkflowService;

  beforeEach(() => {
    stepsService = {
      createMany: jest.fn(),
      findOneWithValidation: jest.fn(),
      updateStatus: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      claimUnprocessed: jest.fn().mockResolvedValue([]),
    };
    processorService = {
      processSteps: jest.fn(),
      completeSteps: jest.fn(),
      updateStepMessages: jest.fn(),
    };
    commentsService = { findMany: jest.fn().mockResolvedValue(comments) };
    eventEmitter = { emit: jest.fn() };

    service = new RequestWorkflowService(
      stepsService as unknown as RequestWorkflowStepsService,
      processorService as unknown as WorkflowStepProcessorService,
      commentsService as unknown as RequestWorkflowStepCommentsService,
      eventEmitter as unknown as EventEmitter2,
    );
  });

  const getFinishedEvent = (): VacationWorkflowFinished => {
    expect(eventEmitter.emit).toHaveBeenCalledTimes(1);

    const [eventName, event] = eventEmitter.emit.mock.calls[0] as [
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

      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
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
          },
        },
      ]);
      expect(processorService.processSteps).toHaveBeenCalledWith(
        [level1Step],
        [],
      );
    });

    it('does nothing when there are no approvers', async () => {
      await service.create({
        requestId: REQUEST_ID,
        slackTeamId: SLACK_TEAM_ID,
        snapshot,
        levels: [],
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
      const nextLevelStep = buildStep({ id: 'step-2', step_level: 2 });

      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.updateStatus
        .mockResolvedValueOnce([approvedStep])
        .mockResolvedValueOnce([otherLevelStep]);
      stepsService.findMany.mockResolvedValue([nextLevelStep]);
      stepsService.claimUnprocessed.mockResolvedValue([nextLevelStep]);

      await service.approveStep(step.id, approver);

      expect(stepsService.updateStatus).toHaveBeenNthCalledWith(
        1,
        { id: step.id, slackTeamId: SLACK_TEAM_ID },
        'approved',
        approver,
      );
      expect(stepsService.updateStatus).toHaveBeenNthCalledWith(
        2,
        { requestId: REQUEST_ID, stepLevel: 1, slackTeamId: SLACK_TEAM_ID },
        'approved',
        approver,
      );
      expect(processorService.completeSteps).toHaveBeenCalledWith(
        [approvedStep, otherLevelStep],
        comments,
      );
      expect(stepsService.count).not.toHaveBeenCalled();
      const nextLevel = {
        requestId: REQUEST_ID,
        stepLevel: 2,
        slackTeamId: SLACK_TEAM_ID,
        completed: false,
      };
      expect(stepsService.findMany).toHaveBeenCalledWith(nextLevel);
      expect(stepsService.claimUnprocessed).toHaveBeenCalledWith(nextLevel);
      expect(processorService.processSteps).toHaveBeenCalledWith(
        [nextLevelStep],
        comments,
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does not ask the next level again when another approver already did', async () => {
      const step = buildStep({ rule: ApprovalRule.Any });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.findMany.mockResolvedValue([
        buildStep({ id: 'step-2', step_level: 2 }),
      ]);
      stepsService.claimUnprocessed.mockResolvedValue([]);

      await service.approveStep(step.id, approver);

      expect(processorService.processSteps).toHaveBeenCalledWith([], comments);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('with ALL rule waits while other approvers of the level are pending', async () => {
      const step = buildStep({ rule: ApprovalRule.All });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.updateStatus.mockResolvedValue([step]);
      stepsService.count.mockResolvedValue(1);

      await service.approveStep(step.id, approver);

      expect(stepsService.updateStatus).toHaveBeenCalledTimes(1);
      expect(processorService.completeSteps).toHaveBeenCalledWith(
        [step],
        comments,
      );
      expect(stepsService.count).toHaveBeenCalledWith({
        requestId: REQUEST_ID,
        stepLevel: 1,
        slackTeamId: SLACK_TEAM_ID,
        completed: false,
      });
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('finishes the workflow as approved after the last approval of the last level', async () => {
      const step = buildStep({ step_level: 2, rule: ApprovalRule.All });
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.updateStatus.mockResolvedValue([step]);
      stepsService.count.mockResolvedValue(0);
      stepsService.findMany.mockResolvedValue([]);

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
  });

  describe('approveCurrentLevel', () => {
    const hr = { ...approver, id: 'hr-1', slack_id: 'U_HR', role: UserRole.HR };

    it('approves every open step of the lowest open level and activates the next one', async () => {
      const level1 = [
        buildStep({ id: 'step-1', rule: ApprovalRule.All }),
        buildStep({ id: 'step-1b', rule: ApprovalRule.All }),
      ];
      const level2 = [buildStep({ id: 'step-2', step_level: 2 })];
      stepsService.findMany
        .mockResolvedValueOnce([...level1, ...level2])
        .mockResolvedValueOnce(level2);
      stepsService.claimUnprocessed.mockResolvedValue(level2);
      stepsService.updateStatus.mockResolvedValue(level1);

      await service.approveCurrentLevel(REQUEST_ID, hr);

      expect(stepsService.updateStatus).toHaveBeenCalledWith(
        {
          requestId: REQUEST_ID,
          stepLevel: 1,
          slackTeamId: SLACK_TEAM_ID,
          completed: false,
        },
        RequestWorkflowStatus.Approved,
        hr,
      );
      expect(processorService.completeSteps).toHaveBeenCalledWith(
        level1,
        comments,
      );
      expect(processorService.processSteps).toHaveBeenCalledWith(
        level2,
        comments,
      );
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('finishes the workflow as approved when it was the last level', async () => {
      const level2 = [buildStep({ id: 'step-2', step_level: 2 })];
      stepsService.findMany
        .mockResolvedValueOnce(level2)
        .mockResolvedValueOnce([]);
      stepsService.updateStatus.mockResolvedValue(level2);

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
      expect(stepsService.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe('rejectStep', () => {
    it('rejects every step of the level and finishes the workflow as rejected', async () => {
      const step = buildStep({ step_level: 1 });
      const rejectedSteps = [step, buildStep({ id: 'step-1b' })];
      stepsService.findOneWithValidation.mockResolvedValue(step);
      stepsService.updateStatus.mockResolvedValue(rejectedSteps);

      await service.rejectStep(step.id, approver);

      expect(stepsService.updateStatus).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, stepLevel: 1, slackTeamId: SLACK_TEAM_ID },
        'rejected',
        approver,
      );
      expect(processorService.completeSteps).toHaveBeenCalledWith(
        rejectedSteps,
        comments,
      );
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(getFinishedEvent().workflow).toEqual({
        requestId: REQUEST_ID,
        status: RequestWorkflowStatus.Rejected,
        slackTeamId: SLACK_TEAM_ID,
        approvedBy: approver.id,
        reviewComments: comments,
      });
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

      expect(stepsService.updateStatus).not.toHaveBeenCalled();
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('ignores Reject when the step is canceled', async () => {
      stepsService.findOneWithValidation.mockResolvedValue(
        decidedStep(WorkflowStepStatus.Cancelled),
      );

      await service.rejectStep('step-1', approver);

      expect(stepsService.updateStatus).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });
  });

  describe('cancel', () => {
    const requester = { ...approver, id: 'requester-1', slack_id: 'U_REQ' };

    it('marks every open step as canceled and closes their messages', async () => {
      const openSteps = [
        buildStep({ id: 'step-1' }),
        buildStep({ id: 'step-2', step_level: 2 }),
      ];
      stepsService.updateStatus.mockResolvedValue(openSteps);

      await service.cancel(REQUEST_ID, requester);

      expect(stepsService.updateStatus).toHaveBeenCalledWith(
        { requestId: REQUEST_ID, slackTeamId: SLACK_TEAM_ID, completed: false },
        RequestWorkflowStatus.Canceled,
        requester,
      );
      expect(processorService.completeSteps).toHaveBeenCalledWith(
        openSteps,
        comments,
      );
      expect(processorService.processSteps).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('does nothing when the request has no open steps', async () => {
      stepsService.updateStatus.mockResolvedValue([]);

      await service.cancel(REQUEST_ID, requester);

      expect(processorService.completeSteps).not.toHaveBeenCalled();
    });
  });
});
