import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { WorkflowStepProcessorsRegistry } from '@modules/request-workflows/workflow-step-processor.registry';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';

export enum WorkflowStepJob {
  Ask = 'workflow-step-ask',
  RefreshMessage = 'workflow-step-refresh-message',
  CloseDeletedMessage = 'workflow-step-close-deleted-message',
}

interface IStepJob {
  stepId: string;
  slackTeamId: string;
}

// The step and its request's comments as they were when the request was
// deleted: the rows go with the request, so there is nothing to load.
interface IDeletedStepJob {
  step: IRequestWorkflowStepViewModel;
  comments: IWorkflowStepCommentViewModel[];
}

// What a workflow step means outside the database: asking its approver, and
// keeping that message up to date. Each is a job (JobsService) per step, so a
// Slack failure is retried and never stops the workflow: the workflow's state
// is in the database. Inside a transaction the jobs are saved in it and start
// after the commit, so they exist exactly when the decision does: await them.
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
    this.jobs.define<IDeletedStepJob>(
      WorkflowStepJob.CloseDeletedMessage,
      (job) => this.closeDeletedMessage(job),
    );
  }

  public processSteps(steps: IRequestWorkflowStepViewModel[]) {
    return this.enqueueForEach(WorkflowStepJob.Ask, steps);
  }

  public updateStepMessages(steps: IRequestWorkflowStepViewModel[]) {
    return this.enqueueForEach(WorkflowStepJob.RefreshMessage, steps);
  }

  // Like updateStepMessages, for the steps of requests that are being
  // deleted: each job carries its step and its request's comments, so that
  // it works (and is retried) after the rows are gone. Steps never asked
  // have no message. One statement saves them all.
  public async updateDeletedStepMessages(
    steps: IRequestWorkflowStepViewModel[],
    comments: IWorkflowStepCommentViewModel[],
  ) {
    await this.jobs.enqueueMany<IDeletedStepJob>(
      WorkflowStepJob.CloseDeletedMessage,
      steps
        .filter(({ slack_message_ts }) => slack_message_ts)
        .map((step) => ({
          step,
          comments: comments.filter(
            ({ request_id }) => request_id === step.request_id,
          ),
        })),
    );
  }

  // Once per step: an approval lists the approved step with its level too.
  private async enqueueForEach(
    job: WorkflowStepJob,
    steps: IRequestWorkflowStepViewModel[],
  ) {
    const unique = new Map(steps.map((step) => [step.id, step]));

    for (const { id, slack_team_id } of unique.values()) {
      await this.jobs.enqueue<IStepJob>(job, {
        stepId: id,
        slackTeamId: slack_team_id,
      });
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

  private async closeDeletedMessage({ step, comments }: IDeletedStepJob) {
    await this.getHandler(step.step_type).updateMessage(step, comments, true);
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
