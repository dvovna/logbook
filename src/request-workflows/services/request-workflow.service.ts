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
import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
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
import UserRole from '@common/enums/user-role.enum';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import { planMoveOn } from '@modules/request-workflows/utils/move-on-plan';
import { todayIso } from '@common/utils/period-presets';
import { IAbsence } from '@modules/users/types/absence.interface';

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
  // What the caller read on the pool for moveOn; read here when not given.
  context?: IMoveOnContext;
}

// What moveOn needs besides the steps: who is on time off today, and the
// workspace's active HR and admins (whom a fallback level goes to). Neither
// needs the request's lock, so it is read on the pool beside it
// (readMoveOnContext) rather than one statement after another inside.
export interface IMoveOnContext {
  away: ReadonlyMap<string, IAbsence>;
  hrAndAdmins: IUserViewModel[];
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

  // Safe to repeat: when an earlier try made the run's steps, only the
  // approvers of the lowest open level who got no message yet are asked
  // (level 1 may have been skipped). A run is made only
  // while no other is open: one started for an edit made since reads the
  // request as it is now.
  public create({
    requestId,
    run,
    levels,
    slackTeamId,
    snapshot,
    context,
  }: ICreateWorkflowParams) {
    const reading = context ?? this.readMoveOnContext(slackTeamId);

    return this.transactions.transaction(async () => {
      await this.lockRequest(requestId);

      const existingSteps = await this.requestWorkflowStepsService.findMany({
        requestId,
        slackTeamId,
      });
      const stepsOfRun = existingSteps.filter((step) => runOf(step) === run);

      if (stepsOfRun.length) {
        const open = stepsOfRun.filter((step) => !step.completed_at);
        const lowest = Math.min(...open.map((step) => step.step_level));

        await this.workflowStepProcessorService.processSteps(
          open.filter((step) => step.step_level === lowest),
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

      await this.moveOn(createdSteps, {
        waitingOn: null,
        approvedBy: null,
        context: await reading,
      });
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
  // however many there are.
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
    const reading = this.readMoveOnContext(approvedBy.slack_team_id);

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

      await this.moveOn(
        await this.findRun(step.request_id, approvedBy.slack_team_id),
        { waitingOn: step.step_level, approvedBy, context: await reading },
      );
    });
  }

  // Skips the open steps of approvers who are on time off today, and moves
  // the request on when that leaves the level it waits on with nobody at
  // work (the daily check, and time off approved for today). Safe to repeat:
  // a closed step stays closed, and a decided request has no open steps.
  public skipAway(requestId: string, slackTeamId: string) {
    const reading = this.readMoveOnContext(slackTeamId);

    return this.transactions.transaction(async () => {
      await this.lockRequest(requestId);

      const steps = await this.findRun(requestId, slackTeamId);
      const open = steps.filter((step) => !step.completed_at);

      if (!open.length) {
        return;
      }

      await this.moveOn(steps, {
        waitingOn: Math.min(...open.map((step) => step.step_level)),
        approvedBy: null,
        context: await reading,
      });
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
    const reading = this.readMoveOnContext(approvedBy.slack_team_id);

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

      await this.moveOn(
        await this.findRun(requestId, approvedBy.slack_team_id),
        {
          waitingOn: currentStep.step_level,
          approvedBy,
          context: await reading,
        },
      );
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

  // See IMoveOnContext. Started before the caller's transaction; a caller
  // that ends without moving on leaves it unawaited, so its failure is
  // caught here and thrown again only to whoever awaits it.
  public readMoveOnContext(slackTeamId: string): Promise<IMoveOnContext> {
    const reading = Promise.all([
      this.usersService.findAway(slackTeamId, todayIso()),
      this.usersService.findMany({
        slackTeamId,
        roles: [UserRole.HR, UserRole.Admin],
      }),
    ]).then(([away, hrAndAdmins]) => ({ away, hrAndAdmins }));

    reading.catch(() => undefined);

    return reading;
  }

  private async findRun(requestId: string, slackTeamId: string) {
    return currentRunOf(
      await this.requestWorkflowStepsService.findMany({
        requestId,
        slackTeamId,
      }),
    );
  }

  // Moves the request on from the level it waits on (`waitingOn`; null for a
  // request just made) by planMoveOn, inside the caller's transaction and
  // lock: approvals carried over from earlier levels (#90), approvers on time
  // off skipped, then the request waits, asks a later level, gets a fallback
  // level above the highest (HR, else the admins), or is approved by the
  // last approval of its last level.
  private async moveOn(
    steps: IRequestWorkflowStepViewModel[],
    {
      waitingOn,
      approvedBy,
      context: { away, hrAndAdmins },
    }: {
      waitingOn: number | null;
      approvedBy: IUserViewModel | null;
      context: IMoveOnContext;
    },
  ) {
    // A rejection ends the run: its later levels only wait for the request
    // to be finished, which closes them.
    if (
      !steps.length ||
      steps.some(
        ({ step_data }) => step_data.status === WorkflowStepStatus.Rejected,
      )
    ) {
      return;
    }

    const [first] = steps;
    const { request_id: requestId, slack_team_id: slackTeamId } = first;
    const ownerId = first.step_data.snapshot.user_id;
    const atWork = fallbackApprovers(
      hrAndAdmins.filter((person) => !away.has(person.slack_id)),
      ownerId,
    );
    const skipped: IRequestWorkflowStepViewModel[] = [];
    let run = steps;
    let from = waitingOn;
    let reportedAfter: number | null | undefined;
    let fallbackMade = false;
    let askedLevel: number;

    // A fallback level is planned again once made, as any level that opens:
    // someone on it who approved this run already is approved as them (#90).
    for (;;) {
      const plan = planMoveOn({
        steps: run,
        waitingOn: from,
        away,
        fallbackAtWork: !fallbackMade && !!atWork,
      });
      const closed: IRequestWorkflowStepViewModel[] = [];

      for (const own of plan.approveAs) {
        const isAnyRule = own.step_data.rule === ApprovalRule.Any;

        closed.push(
          ...(await this.requestWorkflowStepsService.decide(
            {
              requestId,
              slackTeamId,
              ...(isAnyRule
                ? { stepLevel: own.step_level }
                : { stepId: own.id }),
            },
            RequestWorkflowStatus.Approved,
            { slack_id: own.slack_user_id },
          )),
        );
      }

      for (const step of plan.skip) {
        const done = await this.requestWorkflowStepsService.skip(
          step,
          away.get(step.slack_user_id)!.until,
        );

        if (done) {
          skipped.push(done);
          closed.push(done);
        }
      }

      if (closed.length) {
        await this.workflowStepProcessorService.updateStepMessages(closed);
      }

      const { next } = plan;

      if (next.kind === 'wait') {
        return;
      }

      if (next.kind === 'approve') {
        await this.finishWorkflow({
          requestId,
          status: RequestWorkflowStatus.Approved,
          slackTeamId,
          approvedBy:
            approvedBy?.id ??
            (await this.latestApproverOf(run, plan.approveAs, next.level)),
          reviewComments:
            await this.requestWorkflowStepCommentsService.findMany({
              requestId,
              slackTeamId,
            }),
        });

        return;
      }

      reportedAfter ??= next.after;

      if (next.kind === 'ask') {
        askedLevel = next.level;
        break;
      }

      const fallback = !fallbackMade
        ? (atWork ?? fallbackApprovers(hrAndAdmins, ownerId))
        : null;

      if (!fallback) {
        this.logger.warn(
          `Request ${requestId} has nobody left who can approve it`,
        );

        return;
      }

      const highest = Math.max(...run.map((step) => step.step_level));
      const created = await this.requestWorkflowStepsService.createMany(
        fallback.approvers.map(({ slack_id }) => ({
          requestId,
          slackUserId: slack_id,
          stepLevel: highest + 1,
          stepType: WorkflowStepType.Approver,
          slackTeamId,
          stepData: {
            snapshot: first.step_data.snapshot,
            rule: ApprovalRule.Any,
            status: INITIAL_STEP_STATUS,
            run: runOf(first),
            level_name:
              fallback.role === UserRole.HR ? 'HR approval' : 'Admin approval',
          },
        })),
      );
      const closedById = new Map(closed.map((step) => [step.id, step]));

      run = [...run.map((step) => closedById.get(step.id) ?? step), ...created];
      from = highest;
      fallbackMade = true;
    }

    // Two approvers who complete a level at the same time both get here;
    // only the first one asks the next level.
    const claimed = await this.requestWorkflowStepsService.claimUnprocessed({
      requestId,
      slackTeamId,
      stepLevel: askedLevel,
      completed: false,
    });

    await this.workflowStepProcessorService.processSteps(claimed);

    // Whoever asked the level tells the requester, inside the transaction
    // like the jobs above. A new request's own notice says where it went.
    if (waitingOn !== null && claimed.length) {
      await this.eventEmitter.emitAsync(
        VacationWorkflowEventEnum.LevelCompleted,
        new VacationWorkflowLevelCompleted(
          requestId,
          slackTeamId,
          reportedAfter ?? waitingOn,
          askedLevel,
          skipped.map(({ id }) => id),
        ),
      );
    }
  }

  // Who approved the request's last level when nobody clicked now: the one
  // approved as themselves (#90), else the latest approval on it.
  private async latestApproverOf(
    steps: IRequestWorkflowStepViewModel[],
    approvedAs: IRequestWorkflowStepViewModel[],
    level: number,
  ) {
    const latest =
      approvedAs.find((step) => step.step_level === level)?.slack_user_id ??
      steps
        .filter(
          (step) =>
            step.step_level === level &&
            step.step_data.status === WorkflowStepStatus.Approved,
        )
        .map(({ step_data, slack_user_id }) => ({
          at: step_data.decided_at ?? '',
          by: step_data.decided_by_slack_id ?? slack_user_id,
        }))
        .sort((a, b) => a.at.localeCompare(b.at))
        .pop()?.by;
    const user =
      latest &&
      (await this.usersService.findBySlackId(latest, steps[0].slack_team_id));

    if (!user) {
      throw new Error(
        `No approver found for level ${level} of request ${steps[0].request_id}`,
      );
    }

    return user.id;
  }

  // Closes the open steps of someone who can no longer decide them
  // (deactivated, or without an approving role), and moves the request on
  // from the level it waits on, as an approval or a skip does (moveOn).
  public dropApprover(
    requestId: string,
    slackTeamId: string,
    gone: IUserViewModel,
  ) {
    const reading = this.readMoveOnContext(slackTeamId);

    return this.transactions.transaction(async () => {
      await this.lockRequest(requestId);

      const steps = await this.findRun(requestId, slackTeamId);
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

      await this.moveOn(await this.findRun(requestId, slackTeamId), {
        waitingOn: Math.min(...open.map((step) => step.step_level)),
        approvedBy: null,
        context: await reading,
      });
    });
  }
}
