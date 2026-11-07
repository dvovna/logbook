import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import VacationRequestEvent from '@modules/vacation-requests/events/vacation-request-event.enum';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from '@modules/vacation-requests/events/vacation-request.events';
import TeamsService from '@modules/teams/services/teams.service';
import { WorkflowStepType } from '@modules/request-workflows/types/request-workflow-step.interface';
import {
  ICreateWorkflowLevelParams,
  ICreateWorkflowParams,
  RequestWorkflowService,
} from '@modules/request-workflows/services/request-workflow.service';
import { ApprovalRule } from '@modules/teams/enums/approval-rule.enum';
import VacationRequestStatus from '@common/enums/vacation-status.enum';

@Injectable()
export class VacationRequestProcessingService {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly requestWorkflowService: RequestWorkflowService,
  ) {}

  @OnEvent(VacationRequestEvent.Created)
  public async handleRequestCreated({ request }: VacationRequestCreatedEvent) {
    // Admins can create requests that are already approved or rejected;
    // only pending ones need approvers.
    if (request.status !== VacationRequestStatus.Pending) {
      return;
    }

    const team = request.team?.id
      ? await this.teamsService.findOne({
          id: request.team?.id,
          slackTeamId: request.slack_team_id,
        })
      : null;

    if (!team) {
      return;
    }

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

    const levels: ICreateWorkflowLevelParams[] = [
      this.buildApproverLevel(
        notRequester(team.manager_approvers),
        team.manager_approvers_rule,
      ),
      this.buildApproverLevel(
        notRequester(team.hr_approvers),
        team.hr_approvers_rule,
      ),
    ].filter((level): level is ICreateWorkflowLevelParams => level !== null);

    if (levels.length === 0) {
      return;
    }

    workflow.levels = levels;

    await this.requestWorkflowService.create(workflow);
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
