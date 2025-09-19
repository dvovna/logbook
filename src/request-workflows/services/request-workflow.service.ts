import {
  IApproverStepData,
  IRequestSnapshotData,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';
import { Injectable } from '@nestjs/common';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import { WorkflowStepProcessorService } from 'src/request-workflows/services/workflow-step-processor.service';

export interface ICreateWorkflowLevelParams {
  rule?: ApprovalRule;
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

const DEFAULT_STEP_STATUS = 'pending';

@Injectable()
export class RequestWorkflowService {
  public constructor(
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly workflowStepProcessorService: WorkflowStepProcessorService,
  ) {}

  public async create({
    requestId,
    levels,
    slackTeamId,
    snapshot,
  }: ICreateWorkflowParams) {
    const steps = levels.flatMap(({ rule, steps }, levelIndex) =>
      steps.map(({ stepType, slackUserId }) => ({
        requestId,
        slackUserId,
        stepLevel: levelIndex + 1,
        stepType,
        slackTeamId,
        stepData: {
          snapshot,
          ...(stepType === WorkflowStepType.Approver
            ? ({
              rule,
              status: DEFAULT_STEP_STATUS,
            } as IApproverStepData)
            : {}),
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

    if (firstLevelSteps) {
      await this.workflowStepProcessorService.activateSteps(firstLevelSteps);
    }
  }

  // public async approveStep(stepId: string, approverId: string) {
  //   const step = await this.requestWorkflowStepsService.findOne({ id: stepId });
  //
  //   await this.approversRepo.markApproved(stepId, approverId);
  //
  //   if (await this.isStepComplete(step)) {
  //     await this.completeStep(step, true);
  //   }
  // }
  //
  // public async rejectStep(stepId: string, approverId: string) {
  //   await this.approversRepo.markRejected(stepId, approverId);
  //   await this.failWorkflow(stepId, approverId);
  // }
  //
  // public async completeStep(step: VacationRequestStep, success: boolean) {
  //   await this.stepsRepo.markCompleted(step.id, success);
  //
  //   if (success) {
  //     const nextStep = await this.stepsRepo.findNext(
  //       step.workflowId,
  //       step.order,
  //     );
  //
  //     if (nextStep) {
  //       await this.activateSteps(nextStep);
  //     } else {
  //       await this.finishWorkflow(step.workflowId, true);
  //     }
  //   } else {
  //     await this.finishWorkflow(step.workflowId, false);
  //   }
  // }
  //
  // private async finishWorkflow(workflowId: string, success: boolean) {
  //   await this.workflowsRepo.setStatus(
  //     workflowId,
  //     success ? 'approved' : 'rejected',
  //   );
  // }
  //
  // private async failWorkflow(stepId: string, approverId: string) {
  //   const step = await this.stepsRepo.findById(stepId);
  //
  //   await this.stepsRepo.markCompleted(step.id, false);
  //
  //   await this.finishWorkflow(step.workflowId, false);
  // }
}
