import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { ValidationError } from '@common/errors/validation.error';
import { UsersService } from '@modules/users/services/users.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';

export enum WorkflowDecisionJob {
  ApproveStep = 'workflow-step-approve',
  RejectStep = 'workflow-step-reject',
  ApproveLevel = 'workflow-level-approve',
}

interface IDecisionJob {
  userId: string;
  slackTeamId: string;
}

interface IStepDecisionJob extends IDecisionJob {
  stepId: string;
  reason?: string;
}

interface ILevelDecisionJob extends IDecisionJob {
  requestId: string;
}

// Approving and rejecting run as jobs after Slack got its answer, so a
// restart or a failure in the middle is retried instead of losing the click.
// Each call resolves once the first run is over (it never rejects), so the
// caller can then re-render the tab.
@Injectable()
export class WorkflowDecisionsService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowDecisionsService.name);

  public constructor(
    private readonly jobs: JobsService,
    private readonly usersService: UsersService,
    private readonly requestWorkflowService: RequestWorkflowService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IStepDecisionJob>(WorkflowDecisionJob.ApproveStep, (job) =>
      this.decide(job, (user) =>
        this.requestWorkflowService.approveStep(job.stepId, user),
      ),
    );
    this.jobs.define<IStepDecisionJob>(WorkflowDecisionJob.RejectStep, (job) =>
      this.decide(job, (user) =>
        this.requestWorkflowService.rejectStep(job.stepId, user, job.reason),
      ),
    );
    this.jobs.define<ILevelDecisionJob>(
      WorkflowDecisionJob.ApproveLevel,
      (job) =>
        this.decide(job, (user) =>
          this.requestWorkflowService.approveCurrentLevel(job.requestId, user),
        ),
    );
  }

  public approveStep(stepId: string, user: IUserViewModel) {
    return this.jobs.run<IStepDecisionJob>(WorkflowDecisionJob.ApproveStep, {
      stepId,
      ...this.actor(user),
    });
  }

  public rejectStep(stepId: string, user: IUserViewModel, reason?: string) {
    return this.jobs.run<IStepDecisionJob>(WorkflowDecisionJob.RejectStep, {
      stepId,
      reason,
      ...this.actor(user),
    });
  }

  public approveCurrentLevel(requestId: string, user: IUserViewModel) {
    return this.jobs.run<ILevelDecisionJob>(WorkflowDecisionJob.ApproveLevel, {
      requestId,
      ...this.actor(user),
    });
  }

  private actor(user: IUserViewModel): IDecisionJob {
    return { userId: user.id, slackTeamId: user.slack_team_id };
  }

  // A decision that can't be made won't be made by a retry either: the step
  // was decided in the meantime (or by an earlier run of this job), or the
  // user may not decide it. Those end the job; anything else is retried.
  private async decide(
    { userId, slackTeamId }: IDecisionJob,
    decide: (user: IUserViewModel) => Promise<void>,
  ) {
    const user = await this.usersService.findOne({
      id: userId,
      slackTeamId,
      includeInactive: true,
    });

    if (!user) {
      this.logger.warn(`User ${userId} is gone; dropping their decision`);

      return;
    }

    try {
      await decide(user);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ValidationError
      ) {
        this.logger.warn(`Decision not made: ${(error as Error).message}`);

        return;
      }

      throw error;
    }
  }
}
