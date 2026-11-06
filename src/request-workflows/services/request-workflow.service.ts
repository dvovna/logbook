import {
  IRequestSnapshotData,
  IRequestWorkflowStepViewModel,
  WorkflowStepStatus,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import {
  ICreateParams,
  RequestWorkflowStepsService,
} from '@modules/request-workflows/services/request-workflow-steps.service';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { WorkflowStepProcessorService } from '@modules/request-workflows/services/workflow-step-processor.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { VacationWorkflowEventEnum } from '@common/enums/vacation-workflow-event.enum';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { IVacationWorkflow } from '@common/types/vacation-workflow.types';
import { VacationWorkflowFinished } from '@common/events/vacation-workflow.events';
import { WorkflowStepCommentEvent } from '@modules/request-workflows/enums/workflow-step-comment-event.enum';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentAddedEvent } from '@modules/request-workflows/events/request-workflow-step-comment.events';

export interface ICreateWorkflowLevelParams {
  rule: ApprovalRule;
  steps: {
    slackUserId: string;
    stepType: WorkflowStepType;
  }[];
}

export interface ICreateWorkflowParams {
  requestId: string;
  slackTeamId: string;
  snapshot: IRequestSnapshotData;
  levels: ICreateWorkflowLevelParams[];
}

const INITIAL_STEP_STATUS = WorkflowStepStatus.Pending;

@Injectable()
export class RequestWorkflowService {
  private readonly logger = new Logger(RequestWorkflowService.name);

  public constructor(
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly workflowStepProcessorService: WorkflowStepProcessorService,
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public async create({
    requestId,
    levels,
    slackTeamId,
    snapshot,
  }: ICreateWorkflowParams) {
    const steps = levels.flatMap<ICreateParams>(({ rule, steps }, levelIndex) =>
      steps.map<ICreateParams>(({ stepType, slackUserId }) => ({
        requestId,
        slackUserId,
        stepLevel: levelIndex + 1,
        stepType,
        slackTeamId,
        stepData: {
          snapshot,
          rule,
          status: INITIAL_STEP_STATUS,
        },
      })),
    );

    if (steps.length === 0) {
      return;
    }

    const createdSteps =
      await this.requestWorkflowStepsService.createMany(steps);

    const firstLevelSteps = createdSteps.filter(
      (step) => step.step_level === 1,
    );

    if (!firstLevelSteps.length) {
      throw new NotFoundException('No steps found for the first level');
    }

    await this.workflowStepProcessorService.processSteps(firstLevelSteps, []);
  }

  // Closes every open step of the request (on cancel, and on any later update
  // of the request): approvers who got a message see it without buttons, steps
  // of levels that were never reached are closed too, so they never start.
  public async cancel(requestId: string, canceledBy: IUserViewModel) {
    const canceledSteps = await this.requestWorkflowStepsService.updateStatus(
      {
        requestId,
        slackTeamId: canceledBy.slack_team_id,
        completed: false,
      },
      RequestWorkflowStatus.Canceled,
      canceledBy,
    );

    if (canceledSteps.length === 0) {
      return;
    }

    const comments = await this.requestWorkflowStepCommentsService.findMany({
      requestId,
      slackTeamId: canceledBy.slack_team_id,
    });

    await this.workflowStepProcessorService.completeSteps(
      canceledSteps,
      comments,
    );
  }

  public async approveStep(stepId: string, approvedBy: IUserViewModel) {
    const step = await this.requestWorkflowStepsService.findOneWithValidation({
      id: stepId,
      slackTeamId: approvedBy.slack_team_id,
      completed: false,
    });

    if (this.isStepDecided(step)) {
      return;
    }

    const stepsToComplete: IRequestWorkflowStepViewModel[] = [];

    const updatedStep = await this.requestWorkflowStepsService.updateStatus(
      {
        id: stepId,
        slackTeamId: approvedBy.slack_team_id,
      },
      RequestWorkflowStatus.Approved,
      approvedBy,
    );

    stepsToComplete.push(...updatedStep);

    if (step.step_data.rule === ApprovalRule.Any) {
      const levelSteps = await this.completeLevelSteps(
        step.step_level,
        step.request_id,
        approvedBy,
      );

      stepsToComplete.push(...levelSteps);
    }

    const levelComments =
      await this.requestWorkflowStepCommentsService.findMany({
        requestId: step.request_id,
        slackTeamId: step.slack_team_id,
      });

    await this.workflowStepProcessorService.completeSteps(
      stepsToComplete,
      levelComments,
    );

    const isLevelComplete =
      step.step_data.rule === ApprovalRule.Any ||
      (await this.isLevelComplete(step, approvedBy));

    if (isLevelComplete) {
      await this.activateNextLevel(step, approvedBy);
    }
  }

  public async rejectStep(stepId: string, rejectedBy: IUserViewModel) {
    const step = await this.requestWorkflowStepsService.findOneWithValidation({
      id: stepId,
      slackTeamId: rejectedBy.slack_team_id,
    });

    if (this.isStepDecided(step)) {
      return;
    }

    const steps = await this.requestWorkflowStepsService.updateStatus(
      {
        requestId: step.request_id,
        stepLevel: step.step_level,
        slackTeamId: rejectedBy.slack_team_id,
      },
      RequestWorkflowStatus.Rejected,
      rejectedBy,
    );

    const approverComments =
      await this.requestWorkflowStepCommentsService.findMany({
        requestId: step.request_id,
        slackTeamId: step.slack_team_id,
      });

    await this.workflowStepProcessorService.completeSteps(
      steps,
      approverComments,
    );

    this.finishWorkflow({
      requestId: step.request_id,
      status: RequestWorkflowStatus.Rejected,
      slackTeamId: rejectedBy.slack_team_id,
      approvedBy: rejectedBy.id,
      reviewComments: approverComments,
    });
  }

  @OnEvent(WorkflowStepCommentEvent.Added)
  private async handleStepCommentAdded({
    comment,
  }: RequestWorkflowStepCommentAddedEvent) {
    const stepsToUpdate = await this.requestWorkflowStepsService.findMany({
      stepLevel: comment.step_level,
      requestId: comment.request_id,
      slackTeamId: comment.slack_team_id,
      completed: false,
    });

    if (stepsToUpdate.length === 0) {
      this.logger.warn(
        `No steps found for comment ID ${comment.id} at level ${comment.step_level} for request ID ${comment.request_id}`,
      );

      return;
    }

    const comments = await this.requestWorkflowStepCommentsService.findMany({
      requestId: comment.request_id,
      slackTeamId: comment.slack_team_id,
    });

    await this.workflowStepProcessorService.updateStepMessages(
      stepsToUpdate,
      comments,
    );
  }

  private async completeLevelSteps(
    level: number,
    requestId: string,
    approvedBy: IUserViewModel,
  ) {
    return await this.requestWorkflowStepsService.updateStatus(
      {
        requestId,
        stepLevel: level,
        slackTeamId: approvedBy.slack_team_id,
      },
      RequestWorkflowStatus.Approved,
      approvedBy,
    );
  }

  // A button can still be clicked on a message that is already out of date,
  // e.g. after another approver decided (ANY rule) or the request was canceled.
  private isStepDecided(step: IRequestWorkflowStepViewModel) {
    if (step.step_data.status === WorkflowStepStatus.Pending) {
      return false;
    }

    this.logger.warn(
      `Step ${step.id} is already ${step.step_data.status}, ignoring the action`,
    );

    return true;
  }

  private finishWorkflow(workflowData: IVacationWorkflow) {
    this.eventEmitter.emit(
      VacationWorkflowEventEnum.Finished,
      new VacationWorkflowFinished(workflowData),
    );
  }

  private async isLevelComplete(
    step: IRequestWorkflowStepViewModel,
    user: IUserViewModel,
  ): Promise<boolean> {
    const pendingStepsCount = await this.requestWorkflowStepsService.count({
      requestId: step.request_id,
      stepLevel: step.step_level,
      slackTeamId: user.slack_team_id,
      completed: false,
    });

    return pendingStepsCount === 0;
  }

  private async activateNextLevel(
    step: IRequestWorkflowStepViewModel,
    approvedBy: IUserViewModel,
  ) {
    const nextLevelSteps = await this.requestWorkflowStepsService.findMany({
      requestId: step.request_id,
      stepLevel: step.step_level + 1,
      slackTeamId: step.slack_team_id,
      completed: false,
    });

    const approverComments =
      await this.requestWorkflowStepCommentsService.findMany({
        requestId: step.request_id,
        slackTeamId: step.slack_team_id,
      });

    if (nextLevelSteps.length > 0) {
      await this.workflowStepProcessorService.processSteps(
        nextLevelSteps,
        approverComments,
      );

      return;
    }

    this.finishWorkflow({
      requestId: step.request_id,
      status: RequestWorkflowStatus.Approved,
      slackTeamId: step.slack_team_id,
      approvedBy: approvedBy.id,
      reviewComments: approverComments,
    });
  }
}
