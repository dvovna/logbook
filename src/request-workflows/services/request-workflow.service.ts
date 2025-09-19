import {
  IRequestSnapshotData,
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import {
  ICreateParams,
  RequestWorkflowStepsService,
} from 'src/request-workflows/services/request-workflow-steps.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { WorkflowStepProcessorService } from 'src/request-workflows/services/workflow-step-processor.service';
import { IUserViewModel } from 'src/users/types/user.interface';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VacationWorkflowEventEnum } from 'src/common/enums/vacation-workflow-event.enum';
import { RequestWorkflowStatus } from 'src/common/enums/request-workflow-status.enum';
import { IVacationWorkflow } from 'src/common/types/vacation-workflow.types';
import { VacationWorkflowFinished } from 'src/common/events/vacation-workflow.events';

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

const INITIAL_STEP_STATUS = 'pending';

@Injectable()
export class RequestWorkflowService {
  public constructor(
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly workflowStepProcessorService: WorkflowStepProcessorService,
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

    await this.workflowStepProcessorService.activateSteps(firstLevelSteps);
  }

  public async approveStep(stepId: string, approvedBy: IUserViewModel) {
    const step = await this.requestWorkflowStepsService.findOneWithValidation({
      id: stepId,
      slackTeamId: approvedBy.slack_team_id,
    });

    const stepsToComplete: IRequestWorkflowStepViewModel[] = [];

    const updatedStep = await this.requestWorkflowStepsService.updateStatus(
      {
        id: stepId,
        slackTeamId: approvedBy.slack_team_id,
      },
      'approved',
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

    await this.workflowStepProcessorService.completeSteps(stepsToComplete);

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

    const steps = await this.requestWorkflowStepsService.updateStatus(
      {
        requestId: step.request_id,
        stepLevel: step.step_level,
        slackTeamId: rejectedBy.slack_team_id,
      },
      'rejected',
      rejectedBy,
    );

    await this.workflowStepProcessorService.completeSteps(steps);

    this.finishWorkflow({
      requestId: step.request_id,
      status: RequestWorkflowStatus.Rejected,
      slackTeamId: rejectedBy.slack_team_id,
      approvedBy: rejectedBy.id,
    });
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
      'approved',
      approvedBy,
    );
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

    if (nextLevelSteps.length > 0) {
      await this.workflowStepProcessorService.activateSteps(nextLevelSteps);
      return;
    }

    this.finishWorkflow({
      requestId: step.request_id,
      status: RequestWorkflowStatus.Approved,
      slackTeamId: step.slack_team_id,
      approvedBy: approvedBy.id,
    });
  }
}
