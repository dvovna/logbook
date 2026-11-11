import { randomUUID } from 'node:crypto';
import { fallbackApprovers } from '@modules/users/utils/fallback-approvers.utils';
import { VacationsUsageService } from '@modules/vacation-requests/services/vacation-usage.service';
import VacationType from '@common/enums/vacation-type.enum';
import { IRequestContext } from '@modules/request-workflows/types/request-workflow-step.interface';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
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

export const START_WORKFLOW_JOB = 'vacation-request-start-workflow';

interface IStartWorkflowJob {
  requestId: string;
  slackTeamId: string;
  // The run to start (workflow-runs.ts); the first one when missing.
  run?: string;
}

@Injectable()
export class VacationRequestProcessingService implements OnModuleInit {
  public constructor(
    private readonly teamRulesService: TeamRulesService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly jobs: JobsService,
    private readonly vacationsUsageService: VacationsUsageService,
    private readonly timeOffContextService: TimeOffContextService,
  ) {}

  public onModuleInit() {
    this.jobs.define<IStartWorkflowJob>(START_WORKFLOW_JOB, (job) =>
      this.startWorkflow(job),
    );
  }

  // A job, so that a failure to make the workflow is retried instead of
  // leaving the request pending with nobody asked.
  @OnEvent(VacationRequestEvent.Created)
  public handleRequestCreated({ request }: VacationRequestCreatedEvent) {
    // Admins can create requests that are already approved or rejected;
    // only pending ones need approvers.
    if (request.status !== VacationRequestStatus.Pending) {
      return;
    }

    this.jobs.run<IStartWorkflowJob>(START_WORKFLOW_JOB, {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
    });
  }

  private async startWorkflow({
    requestId,
    slackTeamId,
    run = requestId,
  }: IStartWorkflowJob) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    // Canceled or changed before a retry: nothing to ask anymore.
    if (request?.status !== VacationRequestStatus.Pending) {
      return;
    }

    const [rules, approvers] = await Promise.all([
      this.teamRulesService.forTeam(request.team?.id, request.slack_team_id),
      // Everyone who can decide a step: active, with an approving role.
      this.usersService.findMany({
        slackTeamId: request.slack_team_id,
        roles: [...MANAGER_ROLES],
      }),
    ]);
    const roleOf = new Map(
      approvers.map(({ slack_id, role }) => [slack_id, role]),
    );
    const canDecide = new Set(roleOf.keys());

    const workflow: ICreateWorkflowParams = {
      requestId: request.id,
      slackTeamId: request.slack_team_id,
      run,
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
      await this.requestWorkflowService.create({ ...workflow, levels });

      this.eventEmitter.emit(
        VacationRequestEvent.SentForApproval,
        new VacationRequestSentForApprovalEvent(request, null),
      );

      return;
    }

    // Nobody its rules name can approve it, so it would wait forever: it goes
    // to HR instead, or to the admins when there is no HR, and the requester
    // is told so.
    const fallback = this.findFallbackApprovers(request, approvers);

    if (fallback) {
      await this.requestWorkflowService.create({
        ...workflow,
        levels: [
          this.buildApproverLevel(
            fallback.approvers,
            ApprovalRule.Any,
            fallback.role === UserRole.HR ? 'HR approval' : 'Admin approval',
          )!,
        ],
      });
    }

    this.eventEmitter.emit(
      VacationRequestEvent.SentForApproval,
      new VacationRequestSentForApprovalEvent(request, {
        inTeam: Boolean(rules.team),
        followsCompanyRules: rules.followsCompanyRules,
        sentTo: fallback?.role ?? null,
      }),
    );
  }

  // Everyone with the HR role, else every admin; never the requester
  // (fallbackApprovers, as for time entries).
  private findFallbackApprovers(
    request: IVacationRequestViewModel,
    approvers: IUserViewModel[],
  ) {
    const fallback = fallbackApprovers(approvers, request.user!.id);

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
  // decide on.
  @OnEvent(VacationRequestEvent.Updated)
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

    await this.requestWorkflowService.cancel(request.id, updatedBy);

    if (isPending) {
      this.jobs.run<IStartWorkflowJob>(START_WORKFLOW_JOB, {
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
          total: limits.bonusDays,
          unit: 'bonus',
        };
      default:
        return null;
    }
  }
}

const changesWhatApproversDecide = (
  before: IVacationRequestViewModel,
  after: IVacationRequestViewModel,
) =>
  before.start_date !== after.start_date ||
  before.end_date !== after.end_date ||
  before.type !== after.type ||
  before.user_id !== after.user_id;
