import { Injectable, OnModuleInit } from '@nestjs/common';
import { JobsService } from '@common/jobs/jobs.service';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
  VacationRequestWithoutTeamApproversEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import { IVacationRequestViewModel } from '@modules/vacation-requests/types/vacation-request.interface';
import { UsersService } from '@modules/users/services/users.service';
import UserRole from '@common/enums/user-role.enum';
import TeamsService from '@modules/teams/services/teams.service';
import { WorkflowStepType } from '@modules/request-workflows/types/request-workflow-step.interface';
import {
  ICreateWorkflowLevelParams,
  ICreateWorkflowParams,
  RequestWorkflowService,
} from '@modules/request-workflows/services/request-workflow.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';
import { VacationRequestsService } from '@modules/vacation-requests/services/vacation-requests.service';

export const START_WORKFLOW_JOB = 'vacation-request-start-workflow';

interface IStartWorkflowJob {
  requestId: string;
  slackTeamId: string;
}

@Injectable()
export class VacationRequestProcessingService implements OnModuleInit {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly usersService: UsersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly vacationRequestsService: VacationRequestsService,
    private readonly jobs: JobsService,
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

  private async startWorkflow({ requestId, slackTeamId }: IStartWorkflowJob) {
    const request = await this.vacationRequestsService.findOne({
      id: requestId,
      slackTeamId,
    });

    // Canceled or changed before a retry: nothing to ask anymore.
    if (request?.status !== VacationRequestStatus.Pending) {
      return;
    }

    const team = request.team?.id
      ? await this.teamsService.findOne({
          id: request.team?.id,
          slackTeamId: request.slack_team_id,
        })
      : null;

    const workflow: ICreateWorkflowParams = {
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
      },
      levels: [],
    };

    // Nobody approves their own request: a team lead who is one of the
    // team's approvers is left out of their own request's levels, and a
    // level with no one left is skipped.
    const notRequester = (approvers: string[] | null) =>
      approvers?.filter((slackId) => slackId !== request.user!.slack_id) ??
      null;

    const levels: ICreateWorkflowLevelParams[] = team
      ? [
          this.buildApproverLevel(
            notRequester(team.manager_approvers),
            team.manager_approvers_rule,
          ),
          this.buildApproverLevel(
            notRequester(team.hr_approvers),
            team.hr_approvers_rule,
          ),
        ].filter((level): level is ICreateWorkflowLevelParams => level !== null)
      : [];

    if (levels.length) {
      await this.requestWorkflowService.create({ ...workflow, levels });

      return;
    }

    // Nobody on the team can approve it, so it would wait forever: it goes to
    // HR instead, or to the admins when there is no HR, and the requester is
    // told so.
    const fallback = await this.findFallbackApprovers(request);

    if (fallback) {
      await this.requestWorkflowService.create({
        ...workflow,
        levels: [
          this.buildApproverLevel(fallback.approvers, ApprovalRule.Any)!,
        ],
      });
    }

    this.eventEmitter.emit(
      VacationRequestEvent.WithoutTeamApprovers,
      new VacationRequestWithoutTeamApproversEvent(
        request,
        Boolean(team),
        fallback?.role ?? null,
      ),
    );
  }

  // Everyone with the HR role, else every admin; never the requester.
  private async findFallbackApprovers(request: IVacationRequestViewModel) {
    for (const role of [UserRole.HR, UserRole.Admin] as const) {
      const approvers = (
        await this.usersService.findMany({
          slackTeamId: request.slack_team_id,
          role,
        })
      )
        .map(({ slack_id }) => slack_id)
        .filter((slackId) => slackId !== request.user!.slack_id);

      if (approvers.length) {
        return { role, approvers };
      }
    }

    return null;
  }

  @OnEvent(VacationRequestEvent.Updated)
  public async handleRequestUpdated({
    request,
    user: updatedBy,
  }: VacationRequestUpdatedEvent) {
    await this.requestWorkflowService.cancel(request.id, updatedBy);
  }

  private buildApproverLevel(
    approvers: string[] | null,
    rule: ApprovalRule,
  ): ICreateWorkflowLevelParams | null {
    if (!approvers || approvers.length === 0) {
      return null;
    }

    return {
      rule,
      steps: approvers.map((slackUserId) => ({
        slackUserId,
        stepType: WorkflowStepType.Approver,
      })),
    };
  }
}
