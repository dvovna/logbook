import { workflowLock } from 'src/database/advisory-locks';
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
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isPeopleAdmin } from '@modules/users/utils/people-admin-roles';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import { WorkflowStepProcessorService } from '@modules/request-workflows/services/workflow-step-processor.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { VacationWorkflowEventEnum } from '@common/enums/vacation-workflow-event.enum';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { IVacationWorkflow } from '@modules/request-workflows/types/vacation-workflow.types';
import {
  VacationWorkflowFinished,
  VacationWorkflowLevelCompleted,
} from '@modules/request-workflows/events/vacation-workflow.events';
import { WorkflowStepCommentEvent } from '@modules/request-workflows/enums/workflow-step-comment-event.enum';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import { RequestWorkflowStepCommentAddedEvent } from '@modules/request-workflows/events/request-workflow-step-comment.events';
import { ValidationError } from '@common/errors/validation.error';
import { MAX_REJECTION_REASON_LENGTH } from '@common/constants/text-limits';
import { TransactionService } from 'src/database/transaction.service';
import {
  currentRunOf,
  runOf,
} from '@modules/request-workflows/utils/workflow-runs';
import { UsersService } from '@modules/users/services/users.service';

export interface ICreateWorkflowLevelParams {
  rule: ApprovalRule;
  // Who decides at this level, e.g. "Manager approval", for the timeline.
  name?: string;
  steps: {
    slackUserId: string;
    stepType: WorkflowStepType;
  }[];
}

export interface ICreateWorkflowParams {
  requestId: string;
  slackTeamId: string;
  // The run to make (workflow-runs.ts): the request's ID for its first one.
  run: string;
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
    private readonly transactions: TransactionService,
    private readonly usersService: UsersService,
  ) {}

  // Safe to repeat: when an earlier try made the run's steps, only the first
  // level's approvers who got no message yet are asked. A run is made only
  // while no other is open: one started for an edit made since reads the
  // request as it is now.
  public create({
    requestId,
    run,
    levels,
    slackTeamId,
    snapshot,
  }: ICreateWorkflowParams) {
    return this.transactions.transaction(async () => {
      await this.lockRequest(requestId);

      const existingSteps = await this.requestWorkflowStepsService.findMany({
        requestId,
        slackTeamId,
      });
      const stepsOfRun = existingSteps.filter((step) => runOf(step) === run);

      if (stepsOfRun.length) {
        await this.workflowStepProcessorService.processSteps(
          stepsOfRun.filter((step) => step.step_level === 1),
        );

        return;
      }

      if (existingSteps.some((step) => !step.completed_at)) {
        return;
      }

      const steps = levels.flatMap<ICreateParams>(
        ({ rule, name, steps }, levelIndex) =>
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
              run,
              ...(name ? { level_name: name } : {}),
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

      await this.workflowStepProcessorService.processSteps(firstLevelSteps);
    });
  }

  // Closes every open step of the request (on cancel, and on any later update
  // of the request): approvers who got a message see it without buttons, steps
  // of levels that were never reached are closed too, so they never start.
  // `as` is the outcome they show: an edit that approves or rejects the
  // request decides it for them.
  public cancel(
    requestId: string,
    canceledBy: IUserViewModel,
    as:
      | RequestWorkflowStatus.Canceled
      | RequestWorkflowStatus.Approved
      | RequestWorkflowStatus.Rejected = RequestWorkflowStatus.Canceled,
  ) {
    return this.transactions.transaction(async () => {
      await this.lockRequest(requestId);

      const canceledSteps = await this.requestWorkflowStepsService.decide(
        { requestId, slackTeamId: canceledBy.slack_team_id },
        as,
        canceledBy,
      );

      if (canceledSteps.length === 0) {
        return;
      }

      await this.workflowStepProcessorService.updateStepMessages(canceledSteps);
    });
  }

  // Like cancel, for a request that is about to be deleted: call it in the
  // transaction that deletes the request. Its steps and comments go with it
  // (ON DELETE CASCADE), so the jobs that close the approvers' messages carry
  // them, and start only once the delete has committed.
  public closeBeforeDelete(requestId: string, deletedBy: IUserViewModel) {
    return this.closeManyBeforeDelete([requestId], deletedBy);
  }

  // closeBeforeDelete for several requests, in the same few statements
  // however many there are (a CSV import replaces every pending request of
  // the people in it).
  public async closeManyBeforeDelete(
    requestIds: string[],
    deletedBy: IUserViewModel,
  ) {
    if (!requestIds.length) {
      return;
    }

    await this.transactions.transaction(async () => {
      await this.transactions.lockInOrder(...requestIds.map(workflowLock));

      const closedSteps = await this.requestWorkflowStepsService.decide(
        { requestId: requestIds, slackTeamId: deletedBy.slack_team_id },
        RequestWorkflowStatus.Canceled,
        deletedBy,
      );
      // For the messages of the closed steps; a decided request has none.
      const comments = closedSteps.length
        ? await this.requestWorkflowStepCommentsService.findMany({
            requestIds,
            slackTeamId: deletedBy.slack_team_id,
          })
        : [];

      await this.workflowStepProcessorService.updateDeletedStepMessages(
        closedSteps,
        comments,
      );
    });
  }

  // Each decision below is one transaction: the statement that closes the
  // steps it decides, and the jobs that ask the next level, refresh the
  // messages or finish the request. A failure leaves the step open and the
  // click can be repeated; a decision never stays without what follows it.
  public approveStep(stepId: string, approvedBy: IUserViewModel) {
    return this.transactions.transaction(async () => {
      const step = await this.requestWorkflowStepsService.findOneWithValidation(
        {
          id: stepId,
          slackTeamId: approvedBy.slack_team_id,
          completed: false,
        },
      );

      await this.lockRequest(step.request_id);
      this.assertCanActOnStep(step, approvedBy);

      if (this.isStepDecided(step)) {
        return;
      }

      this.assertNotOwnRequest(step, approvedBy);

      // With ANY one approval completes the level: its other steps are closed
      // in the same statement.
      const isAnyRule = step.step_data.rule === ApprovalRule.Any;
      const decidedSteps = await this.requestWorkflowStepsService.decide(
        {
          requestId: step.request_id,
          slackTeamId: approvedBy.slack_team_id,
          ...(isAnyRule ? { stepLevel: step.step_level } : { stepId }),
        },
        RequestWorkflowStatus.Approved,
        approvedBy,
      );

      await this.workflowStepProcessorService.updateStepMessages(decidedSteps);

      // Someone else decided it in the meantime.
      if (!decidedSteps.some(({ id }) => id === stepId)) {
        return;
      }

      const isLevelComplete =
        isAnyRule || (await this.isLevelComplete(step, approvedBy));

      if (isLevelComplete) {
        await this.activateNextLevel(step, approvedBy);
      }
    });
  }

  // The open steps of the level the request is waiting on: the lowest level
  // that still has open steps. Empty when nobody's approval is pending.
  public async findCurrentLevelSteps(requestId: string, slackTeamId: string) {
    const openSteps = await this.requestWorkflowStepsService.findMany({
      requestId,
      slackTeamId,
      completed: false,
    });

    const currentLevel = Math.min(...openSteps.map((step) => step.step_level));

    return openSteps.filter((step) => step.step_level === currentLevel);
  }

  // HR or an admin approves the current level for its approvers, e.g. when a
  // manager is away, so the request moves on to the next level (or gets
  // approved) instead of waiting. With the ALL rule every open step of the
  // level is approved.
  public approveCurrentLevel(requestId: string, approvedBy: IUserViewModel) {
    return this.transactions.transaction(async () => {
      if (!isPeopleAdmin(approvedBy.role)) {
        throw new ForbiddenException(
          'Only HR and admins can approve for the approvers.',
        );
      }

      await this.lockRequest(requestId);

      const [currentStep] = await this.findCurrentLevelSteps(
        requestId,
        approvedBy.slack_team_id,
      );

      if (!currentStep) {
        throw new ValidationError(
          'This request is not waiting for anyone to approve it.',
        );
      }

      this.assertNotOwnRequest(currentStep, approvedBy);

      const approvedSteps = await this.requestWorkflowStepsService.decide(
        {
          requestId,
          stepLevel: currentStep.step_level,
          slackTeamId: approvedBy.slack_team_id,
        },
        RequestWorkflowStatus.Approved,
        approvedBy,
      );

      // An approver decided the level in the meantime and moved it on.
      if (approvedSteps.length === 0) {
        return;
      }

      await this.workflowStepProcessorService.updateStepMessages(approvedSteps);

      await this.activateNextLevel(currentStep, approvedBy);
    });
  }

  public rejectStep(
    stepId: string,
    rejectedBy: IUserViewModel,
    reason?: string,
  ) {
    return this.transactions.transaction(async () => {
      if (reason && reason.trim().length > MAX_REJECTION_REASON_LENGTH) {
        throw new ValidationError(
          `Reason must be at most ${MAX_REJECTION_REASON_LENGTH} characters`,
          'reason',
        );
      }

      const step = await this.requestWorkflowStepsService.findOneWithValidation(
        {
          id: stepId,
          slackTeamId: rejectedBy.slack_team_id,
        },
      );

      await this.lockRequest(step.request_id);
      this.assertCanActOnStep(step, rejectedBy);

      if (this.isStepDecided(step)) {
        return;
      }

      this.assertNotOwnRequest(step, rejectedBy, 'reject');

      // One rejection rejects the level, and with it the request.
      const rejectedSteps = await this.requestWorkflowStepsService.decide(
        {
          requestId: step.request_id,
          stepLevel: step.step_level,
          slackTeamId: rejectedBy.slack_team_id,
        },
        RequestWorkflowStatus.Rejected,
        rejectedBy,
        reason?.trim() || undefined,
      );

      await this.workflowStepProcessorService.updateStepMessages(rejectedSteps);

      // Someone else decided it in the meantime.
      if (!rejectedSteps.some(({ id }) => id === stepId)) {
        return;
      }

      const approverComments =
        await this.requestWorkflowStepCommentsService.findMany({
          requestId: step.request_id,
          slackTeamId: step.slack_team_id,
        });

      await this.finishWorkflow({
        requestId: step.request_id,
        status: RequestWorkflowStatus.Rejected,
        slackTeamId: rejectedBy.slack_team_id,
        approvedBy: rejectedBy.id,
        reviewComments: approverComments,
        rejectionReason: reason?.trim() || undefined,
      });
    });
  }

  // Runs in the comment's transaction (emitAsync): the jobs that refresh the
  // messages are saved with it.
  @OnEvent(WorkflowStepCommentEvent.Added, { suppressErrors: false })
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

    await this.workflowStepProcessorService.updateStepMessages(stepsToUpdate);
  }

  // Decisions on one request wait for each other. With the ALL rule two
  // approvers deciding at once would each miss the other's decision, not yet
  // committed, and neither would ask the next level.
  private lockRequest(requestId: string) {
    return this.transactions.lock(workflowLock(requestId));
  }

  // A step belongs to its approver. HR and admins may decide for an approver
  // who is away (see CLAUDE.md); anyone else only their own step, whatever
  // step ID the client sends.
  public assertCanActOnStep(
    step: IRequestWorkflowStepViewModel,
    user: IUserViewModel,
  ) {
    if (step.slack_user_id !== user.slack_id && !isPeopleAdmin(user.role)) {
      throw new ForbiddenException(
        'This approval is assigned to someone else.',
      );
    }
  }

  // Requesters are left out of their own approval levels, but a workflow made
  // before that, or HR approving for the approvers, could still reach them.
  public assertNotOwnRequest(
    step: IRequestWorkflowStepViewModel,
    user: IUserViewModel,
    action: 'approve' | 'reject' = 'approve',
  ) {
    if (step.step_data.snapshot.user_id === user.id) {
      throw new ValidationError(
        `You can't ${action} your own vacation request.`,
      );
    }
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

  // Delivered inside the decision's transaction (emitAsync, not emit, which
  // waits for the commit): its listener saves the job that finishes the
  // request together with the decision.
  private async finishWorkflow(workflowData: IVacationWorkflow) {
    await this.eventEmitter.emitAsync(
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

  // Asks the lowest level above `step`'s that has open steps: a level whose
  // approvers all lost the right to decide since the workflow started is
  // passed over, as it would be for a request made now. Someone on it who
  // approved this run already isn't asked again: their step is approved as
  // them, which with the ANY rule (or nobody else left) completes the level,
  // and the next one opens the same way. With no level left the request is
  // approved.
  private async activateNextLevel(
    step: IRequestWorkflowStepViewModel,
    approvedBy: IUserViewModel,
  ) {
    const { request_id: requestId, slack_team_id: slackTeamId } = step;
    let completedLevel = step.step_level;

    for (;;) {
      const steps = currentRunOf(
        await this.requestWorkflowStepsService.findMany({
          requestId,
          slackTeamId,
        }),
      );
      const openAbove = steps.filter(
        (other) => !other.completed_at && other.step_level > completedLevel,
      );

      if (!openAbove.length) {
        break;
      }

      const nextLevel = Math.min(...openAbove.map((other) => other.step_level));
      const levelSteps = openAbove.filter(
        (other) => other.step_level === nextLevel,
      );
      const approvedAlready = new Set(
        steps
          .filter(
            ({ step_data }) => step_data.status === WorkflowStepStatus.Approved,
          )
          .map(
            ({ step_data, slack_user_id }) =>
              step_data.decided_by_slack_id ?? slack_user_id,
          ),
      );
      const theirs = levelSteps.filter((other) =>
        approvedAlready.has(other.slack_user_id),
      );

      if (theirs.length) {
        const isAnyRule = theirs[0].step_data.rule === ApprovalRule.Any;

        for (const own of isAnyRule ? [theirs[0]] : theirs) {
          await this.requestWorkflowStepsService.decide(
            {
              requestId,
              slackTeamId,
              ...(isAnyRule ? { stepLevel: nextLevel } : { stepId: own.id }),
            },
            RequestWorkflowStatus.Approved,
            { slack_id: own.slack_user_id },
          );
        }

        if (isAnyRule || theirs.length === levelSteps.length) {
          completedLevel = nextLevel;
          continue;
        }
      }

      // Two approvers who complete the level at the same time both get here;
      // only the first one asks the next level.
      const claimedSteps =
        await this.requestWorkflowStepsService.claimUnprocessed({
          requestId,
          stepLevel: nextLevel,
          slackTeamId,
          completed: false,
        });

      await this.workflowStepProcessorService.processSteps(claimedSteps);

      // Whoever asked the next level tells the requester, inside the
      // decision's transaction like the jobs above.
      if (claimedSteps.length > 0) {
        await this.eventEmitter.emitAsync(
          VacationWorkflowEventEnum.LevelCompleted,
          new VacationWorkflowLevelCompleted(
            requestId,
            slackTeamId,
            completedLevel,
            nextLevel,
          ),
        );
      }

      return;
    }

    await this.finishWorkflow({
      requestId,
      status: RequestWorkflowStatus.Approved,
      slackTeamId,
      approvedBy: approvedBy.id,
      reviewComments: await this.requestWorkflowStepCommentsService.findMany({
        requestId,
        slackTeamId,
      }),
    });
  }

  // Closes the open steps of someone who can no longer decide them
  // (deactivated, or without an approving role), and moves the request on
  // when the level it waits on is left with nobody: when someone on it
  // approved (the ALL rule) the level is done; else the next level is asked,
  // as for a request made now, or with none left `fallback` (HR, or the
  // admins), who get the level.
  public dropApprover(
    requestId: string,
    slackTeamId: string,
    gone: IUserViewModel,
    fallback: { slackIds: string[]; levelName: string } | null,
  ) {
    return this.transactions.transaction(async () => {
      await this.lockRequest(requestId);

      const steps = currentRunOf(
        await this.requestWorkflowStepsService.findMany({
          requestId,
          slackTeamId,
        }),
      );
      const open = steps.filter((step) => !step.completed_at);
      const theirs = open.filter(
        (step) => step.slack_user_id === gone.slack_id,
      );

      if (!theirs.length) {
        return;
      }

      const closed: IRequestWorkflowStepViewModel[] = [];

      for (const step of theirs) {
        closed.push(
          ...(await this.requestWorkflowStepsService.decide(
            { requestId, slackTeamId, stepId: step.id },
            RequestWorkflowStatus.Canceled,
            gone,
          )),
        );
      }

      await this.workflowStepProcessorService.updateStepMessages(closed);

      const level = Math.min(...open.map((step) => step.step_level));
      const others = open.filter((step) => !theirs.includes(step));
      const atLevel = steps.filter((step) => step.step_level === level);

      if (
        !theirs.some((step) => step.step_level === level) ||
        others.some((step) => step.step_level === level)
      ) {
        return;
      }

      const approved = atLevel
        .filter(
          ({ step_data }) => step_data.status === WorkflowStepStatus.Approved,
        )
        .sort((a, b) =>
          (a.step_data.decided_at ?? '').localeCompare(
            b.step_data.decided_at ?? '',
          ),
        );

      if (approved.length) {
        const last = approved[approved.length - 1];
        const lastApprover = await this.usersService.findBySlackId(
          last.step_data.decided_by_slack_id ?? last.slack_user_id,
          slackTeamId,
        );

        await this.activateNextLevel(last, lastApprover ?? gone);

        return;
      }

      if (others.length) {
        await this.activateNextLevel(atLevel[0], gone);

        return;
      }

      if (!fallback?.slackIds.length) {
        this.logger.warn(
          `Request ${requestId} has nobody left who can approve it`,
        );

        return;
      }

      const { snapshot } = atLevel[0].step_data;
      const created = await this.requestWorkflowStepsService.createMany(
        fallback.slackIds.map((slackUserId) => ({
          requestId,
          slackUserId,
          stepLevel: level,
          stepType: WorkflowStepType.Approver,
          slackTeamId,
          stepData: {
            snapshot,
            rule: ApprovalRule.Any,
            status: INITIAL_STEP_STATUS,
            run: runOf(atLevel[0]),
            level_name: fallback.levelName,
          },
        })),
      );

      await this.workflowStepProcessorService.processSteps(created);
    });
  }
}
