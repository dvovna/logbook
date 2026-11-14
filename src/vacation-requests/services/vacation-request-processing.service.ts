import { randomUUID } from 'node:crypto';
import { todayIso } from '@common/utils/period-presets';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import VacationType from '@common/enums/vacation-type.enum';
import { IRequestContext } from '@modules/request-workflows/types/request-workflow-step.interface';
import { IAbsence } from '@modules/users/types/absence.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { reportError } from '@common/errors/error-reporter';
import {
  IStartWaitingJob,
  START_WAITING_JOB,
} from '@modules/vacation-requests/constants/jobs';
import { JobsService } from '@common/jobs/jobs.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  IApprovalFallback,
  VacationRequestCreatedEvent,
  VacationRequestSentForApprovalEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { UsersService } from '@modules/users/services/users.service';
import UserRole from '@common/enums/user-role.enum';
import { MANAGER_ROLES } from '@common/constants/role-groups';
import { TeamRulesService } from '@modules/teams/services/team-rules.service';
import { WorkflowStepType } from '@modules/request-workflows/types/request-workflow-step.interface';
import {
  ICreateWorkflowLevelParams,
  ICreateWorkflowParams,
  RequestWorkflowService,
} from '@modules/request-workflows/services/request-workflow.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';
import { TimeOffContextService } from '@modules/vacation-requests/services/time-off-context.service';
import { TransactionService } from 'src/database/transaction.service';
import { vacationRequestLock } from 'src/database/advisory-locks';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';
import { runOf } from '@modules/request-workflows/utils/workflow-runs';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { decidesRequest } from '@modules/vacation-requests/utils/request-decision.utils';
import {
  APPROVERS_CHANGED,
  ApproversChangedEvent,
} from '@modules/users/events/users.events';

export const START_WORKFLOW_JOB = 'vacation-request-start-workflow';

interface IStartWorkflowJob {
  requestId: string;
  slackTeamId: string;
  // The run to start (workflow-runs.ts); the first one when missing.
  run?: string;
}

// What a request's approval would be now: its workflow, or null when nobody
// can approve it, and why it went to HR or the admins, or to nobody.
interface IApprovalPlan {
  workflow: Omit<ICreateWorkflowParams, 'run'> | null;
  fallback: IApprovalFallback | null;
}

@Injectable()
export class VacationRequestProcessingService implements OnModuleInit {
  private readonly logger = new Logger(VacationRequestProcessingService.name);

  public constructor(
    private readonly teamRulesService: TeamRulesService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly jobs: JobsService,
    private readonly vacationsUsageService: VacationsUsageService,
    private readonly timeOffContextService: TimeOffContextService,
    private readonly transactions: TransactionService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IStartWorkflowJob>(START_WORKFLOW_JOB, (job) =>
      this.start(job),
    );
    this.jobs.define<IStartWaitingJob>(START_WAITING_JOB, (job) =>
      this.startWaiting(job),
    );
  }

  // A job, so that a failure to make the workflow is retried instead of
  // leaving the request pending with nobody asked. Saved in the request's
  // transaction (emitAsync), so a crash can't leave one without the other.
  @OnEvent(VacationRequestEvent.Created, { suppressErrors: false })
  public async handleRequestCreated({ request }: VacationRequestCreatedEvent) {
    // Admins can create requests that are already approved or rejected;
    // only pending ones need approvers.
    if (request.status !== VacationRequestStatus.Pending) {
      return;
    }

    await this.jobs.enqueue<IStartWorkflowJob>(START_WORKFLOW_JOB, {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
    });
  }

  // Someone may now approve the requests that found nobody who could: the
  // job that starts them is saved with the change (emitAsync). One for the
  // transaction, however many of its changes call for it (a team file).
  @OnEvent(APPROVERS_CHANGED, { suppressErrors: false })
  public async handleApproversChanged({ slackTeamId }: ApproversChangedEvent) {
    await this.transactions.once(`${START_WAITING_JOB}:${slackTeamId}`, () =>
      this.jobs.enqueue<IStartWaitingJob>(START_WAITING_JOB, { slackTeamId }),
    );
  }

  // Each in a transaction of its own. A request that fails to start is
  // reported and left waiting, and the others go on: retrying the job would
  // retry all of them for hours over one that may never start. The next
  // change of approvers, or the daily look (MemberSyncScheduleService),
  // tries it again. The look again at one request is retried as a job.
  private async startWaiting({ slackTeamId, requestId }: IStartWaitingJob) {
    const waiting = await this.vacationRequestsService.findAwaitingApprovers(
      slackTeamId,
      requestId,
    );

    for (const { id } of waiting) {
      try {
        await this.start({ requestId: id, slackTeamId }, { waiting: true });
      } catch (error) {
        if (requestId) {
          throw error;
        }

        this.logger.error(
          `Could not start the approval of request ${id}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        reportError(error, {
          task: 'start a request waiting for approvers',
          requestId: id,
        });
      }
    }
  }

  // Asks the approvers of a pending request, and tells the requester where
  // it went. When nobody can approve it, it waits for someone who can
  // (awaits_approvers) and the requester is told so; `waiting` (a change of
  // approvers) then starts it as a new request would, or leaves it and tells
  // nobody again.
  //
  // Planned on the pool; the start itself is one transaction under the
  // request's lock, which an edit and a cancel take too. Whoever comes second
  // sees what the first did: no request gets two workflows, nor a requester
  // two DMs.
  private async start(
    { requestId, slackTeamId, run: jobRun }: IStartWorkflowJob,
    { waiting = false } = {},
  ) {
    const find = () =>
      this.vacationRequestsService.findOne({ id: requestId, slackTeamId });
    const read = await find();

    if (!awaitsStart(read, waiting)) {
      return;
    }

    const planned = await this.plan(read);

    await this.transactions.transaction(async () => {
      await this.transactions.lock(vacationRequestLock(requestId));

      const [request, steps] = await Promise.all([
        find(),
        this.requestWorkflowStepsService.findMany({ requestId, slackTeamId }),
      ]);
      // A waiting request asked before had its run closed by an edit.
      const run =
        jobRun ?? (waiting && steps.length ? randomUUID() : requestId);

      // Canceled or decided meanwhile; or started already, by an earlier try
      // of this job, a later edit's run or a change of approvers.
      if (
        !awaitsStart(request, waiting) ||
        steps.some((step) => !step.completed_at || runOf(step) === run)
      ) {
        return;
      }

      // Edited since it was planned: the approvers decide on it as it is.
      const { workflow, fallback } =
        request.updated_at === read.updated_at
          ? planned
          : await this.plan(request);

      if (!workflow && waiting) {
        return;
      }

      if (workflow) {
        await this.requestWorkflowService.create({ ...workflow, run });
      } else {
        // A change that made someone an approver while this read the rules
        // looked for waiting requests before this one waited: look again
        // once it does.
        await this.jobs.enqueue<IStartWaitingJob>(START_WAITING_JOB, {
          slackTeamId,
          requestId,
        });
      }

      await this.vacationRequestsService.setAwaitsApprovers(request, !workflow);
      // The job that tells the requester, saved with the workflow.
      await this.eventEmitter.emitAsync(
        VacationRequestEvent.SentForApproval,
        new VacationRequestSentForApprovalEvent(request, fallback),
      );
    });
  }

  private async plan(
    request: IVacationRequestViewModel,
  ): Promise<IApprovalPlan> {
    const [rules, approvers, away] = await Promise.all([
      this.teamRulesService.forTeam(request.team?.id, request.slack_team_id),
      // Everyone who can decide a step: active, with an approving role.
      this.usersService.findMany({
        slackTeamId: request.slack_team_id,
        roles: [...MANAGER_ROLES],
      }),
      this.usersService.findAway(request.slack_team_id, todayIso()),
    ]);
    const roleOf = new Map(
      approvers.map(({ slack_id, role }) => [slack_id, role]),
    );
    const canDecide = new Set(roleOf.keys());

    const workflow: Omit<ICreateWorkflowParams, 'run'> = {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      snapshot: {
        user_id: request.user!.id,
        slack_user_id: request.user!.slack_id,
        user_name: request.user!.name,
        user_email: request.user!.email,
        start_date: request.start_date,
        end_date: request.end_date,
        type: request.type,
        comment: request.user_comment || '',
        days: request.days,
        working_days: request.working_days,
        context: await this.buildContext(request),
      },
      levels: [],
    };

    // Nobody approves their own request: a team lead who is one of the
    // team's approvers is left out of their own request's levels. Neither
    // is anyone deactivated or without an approving role since the rules
    // named them: they couldn't decide. A level with no one left is skipped.
    // A person in no team has no level 1.
    const whoCanDecide = (listed: string[]) => [
      ...new Set(
        listed.filter(
          (slackId) =>
            slackId !== request.user!.slack_id && canDecide.has(slackId),
        ),
      ),
    ];

    const levels: ICreateWorkflowLevelParams[] = [
      this.buildApproverLevel(
        whoCanDecide(rules.managerApprovers),
        rules.managerApproversRule,
        'Manager approval',
      ),
      this.buildApproverLevel(
        whoCanDecide(rules.hrApprovers),
        rules.hrApproversRule,
        // Named by who decides it: level 2 takes HR and admins.
        whoCanDecide(rules.hrApprovers).every(
          (slackId) => roleOf.get(slackId) === UserRole.Admin,
        )
          ? 'Admin approval'
          : 'HR approval',
      ),
    ].filter((level): level is ICreateWorkflowLevelParams => level !== null);

    if (levels.length) {
      return { workflow: { ...workflow, levels }, fallback: null };
    }

    // Nobody its rules name can approve it, so it would wait forever: it goes
    // to HR instead, or to the admins when there is no HR, and the requester
    // is told so.
    const fallback = this.findFallbackApprovers(request, approvers, away);

    return {
      workflow: fallback && {
        ...workflow,
        levels: [
          this.buildApproverLevel(
            fallback.approvers,
            ApprovalRule.Any,
            fallback.role === UserRole.HR ? 'HR approval' : 'Admin approval',
          )!,
        ],
      },
      fallback: {
        inTeam: Boolean(rules.team),
        followsCompanyRules: rules.followsCompanyRules,
        sentTo: fallback?.role ?? null,
      },
    };
  }

  // Everyone with the HR role, else every admin; never the requester
  // (fallbackApprovers, as for time entries). People on approved time off
  // are left out; when that leaves nobody, everyone is asked anyway.
  private findFallbackApprovers(
    request: IVacationRequestViewModel,
    approvers: IUserViewModel[],
    away: ReadonlyMap<string, IAbsence>,
  ) {
    const ownerId = request.user!.id;
    const fallback =
      fallbackApprovers(
        approvers.filter(({ slack_id }) => !away.has(slack_id)),
        ownerId,
      ) ?? fallbackApprovers(approvers, ownerId);

    return (
      fallback && {
        role: fallback.role,
        approvers: fallback.approvers.map(({ slack_id }) => slack_id),
      }
    );
  }

  // An edit that changes what the approvers decide on closes the steps
  // asked so far; when the request is still pending, its approval starts
  // again with the request as it is now. A comment changes nothing they
  // decide on. Runs in the change's transaction (emitAsync): the steps
  // close, and the new run is saved, with the change.
  @OnEvent(VacationRequestEvent.Updated, { suppressErrors: false })
  public async handleRequestUpdated({
    request,
    user: updatedBy,
    previous,
  }: VacationRequestUpdatedEvent) {
    const isPending = request.status === VacationRequestStatus.Pending;

    if (
      isPending &&
      previous?.status === VacationRequestStatus.Pending &&
      !changesWhatApproversDecide(previous, request)
    ) {
      return;
    }

    // Steps are open while a request waits for approval. After a change of
    // one that didn't wait and still doesn't (or the workflow's own finish),
    // closing them only tidies up after a race: it waits for the commit
    // instead of holding the change's transaction.
    if (!isPending && previous?.status !== VacationRequestStatus.Pending) {
      this.transactions.afterCommit(() =>
        this.requestWorkflowService.cancel(request.id, updatedBy),
      );

      return;
    }

    // Approved or rejected with Edit Request: the approvers' messages show
    // the decision and who made it, as the requester's does.
    await this.requestWorkflowService.cancel(
      request.id,
      updatedBy,
      !previous || !decidesRequest(previous, request)
        ? RequestWorkflowStatus.Canceled
        : request.status === VacationRequestStatus.Approved
          ? RequestWorkflowStatus.Approved
          : RequestWorkflowStatus.Rejected,
    );

    if (isPending) {
      await this.jobs.enqueue<IStartWorkflowJob>(START_WORKFLOW_JOB, {
        requestId: request.id,
        slackTeamId: request.slack_team_id,
        run: randomUUID(),
      });
    }
  }

  private buildApproverLevel(
    approvers: string[],
    rule: ApprovalRule,
    name: string,
  ): ICreateWorkflowLevelParams | null {
    if (approvers.length === 0) {
      return null;
    }

    return {
      rule,
      name,
      steps: approvers.map((slackUserId) => ({
        slackUserId,
        stepType: WorkflowStepType.Approver,
      })),
    };
  }

  // What the approvers see beside the request: the requester's balance once it
  // counts, and who else in the team is off on those days.
  private async buildContext(
    request: IVacationRequestViewModel,
  ): Promise<IRequestContext> {
    const owner = await this.usersService.findOne({
      id: request.user_id,
      slackTeamId: request.slack_team_id,
      includeInactive: true,
    });

    return {
      balance_after: owner ? await this.findBalanceAfter(owner, request) : null,
      also_off: await this.timeOffContextService.findColleaguesOff(request, {
        forRequester: false,
      }),
    };
  }

  // A pending request already counts as used, so what is available now is
  // what is left after it, in the vacation year of its first day.
  private async findBalanceAfter(
    owner: IUserViewModel,
    request: IVacationRequestViewModel,
  ): Promise<IRequestContext['balance_after']> {
    const { limits, usage } =
      await this.vacationsUsageService.getVacationPeriodUsage(
        owner,
        new Date(request.start_date),
      );

    if (!limits) {
      return null;
    }

    switch (request.type) {
      case VacationType.AnnualLeave:
        return {
          available: usage[VacationType.AnnualLeave].available,
          total: limits.daysTotal,
          unit: 'vacation',
        };
      case VacationType.BonusDay:
        return {
          available: usage[VacationType.BonusDay].available,
          total: limits.bonusDays + (limits.correction?.bonusDays ?? 0),
          unit: 'bonus',
        };
      default:
        return null;
    }
  }
}

// Pending, and when `waiting`, waiting for anyone who can approve it.
const awaitsStart = (
  request: IVacationRequestViewModel | null,
  waiting: boolean,
): request is IVacationRequestViewModel =>
  request?.status === VacationRequestStatus.Pending &&
  (!waiting || !!request.awaits_approvers);

const changesWhatApproversDecide = (
  before: IVacationRequestViewModel,
  after: IVacationRequestViewModel,
) =>
  before.start_date !== after.start_date ||
  before.end_date !== after.end_date ||
  before.type !== after.type ||
  before.user_id !== after.user_id;
