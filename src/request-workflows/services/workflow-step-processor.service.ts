import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { WorkflowStepProcessorsRegistry } from '@modules/request-workflows/workflow-step-processor.registry';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';

export enum WorkflowStepJob {
  Ask = 'workflow-step-ask',
  RefreshMessage = 'workflow-step-refresh-message',
}

interface IStepJob {
  stepId: string;
  slackTeamId: string;
}

// What a workflow step means outside the database: asking its approver, and
// keeping that message up to date. Each is a job (JobsService) per step, so a
// Slack failure is retried and never stops the workflow: the workflow's state
// is in the database, written before the jobs start.
@Injectable()
export class WorkflowStepProcessorService implements OnModuleInit {
  public constructor(
    private readonly registry: WorkflowStepProcessorsRegistry,
    private readonly jobs: JobsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IStepJob>(WorkflowStepJob.Ask, (job) => this.ask(job));
    this.jobs.define<IStepJob>(WorkflowStepJob.RefreshMessage, (job) =>
      this.refreshMessage(job),
    );
  }

  public processSteps(steps: IRequestWorkflowStepViewModel[]) {
    this.runForEach(WorkflowStepJob.Ask, steps);
  }

  // The steps are done: they no longer count as open from now on, whether
  // their messages are updated yet or not.
  public async completeSteps(steps: IRequestWorkflowStepViewModel[]) {
    if (steps.length === 0) {
      return;
    }

    await this.requestWorkflowStepsService.markCompleted(
      [...new Set(steps.map(({ id }) => id))],
      steps[0].slack_team_id,
    );

    this.runForEach(WorkflowStepJob.RefreshMessage, steps);
  }

  public updateStepMessages(steps: IRequestWorkflowStepViewModel[]) {
    this.runForEach(WorkflowStepJob.RefreshMessage, steps);
  }

  // Once per step: an approval lists the approved step with its level too.
  private runForEach(
    job: WorkflowStepJob,
    steps: IRequestWorkflowStepViewModel[],
  ) {
    const unique = new Map(steps.map((step) => [step.id, step]));

    for (const { id, slack_team_id } of unique.values()) {
      this.jobs.run<IStepJob>(job, { stepId: id, slackTeamId: slack_team_id });
    }
  }

  private async ask({ stepId, slackTeamId }: IStepJob) {
    const step = await this.requestWorkflowStepsService.findOne({
      id: stepId,
      slackTeamId,
      completed: false,
    });

    // Decided or canceled before the retry, or asked already by a run that
    // failed after the message was sent.
    if (!step || step.slack_message_ts) {
      return;
    }

    await this.getHandler(step.step_type).processPending(
      step,
      await this.commentsOf(step),
    );
  }

  private async refreshMessage({ stepId, slackTeamId }: IStepJob) {
    const step = await this.requestWorkflowStepsService.findOne({
      id: stepId,
      slackTeamId,
    });

    // A step of a level that was never reached has no message; one that is
    // asked later gets the current state then.
    if (!step?.slack_message_ts) {
      return;
    }

    await this.getHandler(step.step_type).updateMessage(
      step,
      await this.commentsOf(step),
    );
  }

  private commentsOf(step: IRequestWorkflowStepViewModel) {
    return this.requestWorkflowStepCommentsService.findMany({
      requestId: step.request_id,
      slackTeamId: step.slack_team_id,
    });
  }

  private getHandler(stepType: WorkflowStepType) {
    const handler = this.registry.getHandler(stepType);

    if (!handler) {
      throw new Error(`No handler found for step type: ${stepType}`);
    }

    return handler;
  }
}
