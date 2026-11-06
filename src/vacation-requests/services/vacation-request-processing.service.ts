import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import {
  VacationRequestCreatedEvent,
  VacationRequestUpdatedEvent,
} from 'src/vacation-requests/events/vacation-request.events';
import TeamsService from 'src/teams/services/teams.service';
import { WorkflowStepType } from 'src/request-workflows/types/request-workflow-step.interface';
import {
  ICreateWorkflowLevelParams,
  ICreateWorkflowParams,
  RequestWorkflowService,
} from 'src/request-workflows/services/request-workflow.service';
import { ApprovalRule } from 'src/teams/enums/approval-rule.enum';
import VacationRequestStatus from 'src/common/enums/vacation-status.enum';

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

    const levels: ICreateWorkflowLevelParams[] = [
      this.buildApproverLevel(
        team.manager_approvers,
        team.manager_approvers_rule,
      ),
      this.buildApproverLevel(team.hr_approvers, team.hr_approvers_rule),
    ].filter((level): level is ICreateWorkflowLevelParams => level !== null);

    if (levels.length === 0) {
      return;
    }

    workflow.levels = levels;

    await this.requestWorkflowService.create(workflow);
  }

  @OnEvent(VacationRequestEvent.Canceled)
  public async handleRequestCanceled({
    request,
    user,
  }: VacationRequestUpdatedEvent) {
    await this.requestWorkflowService.cancel(request.id, user);
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
