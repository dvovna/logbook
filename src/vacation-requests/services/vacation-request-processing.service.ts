import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import VacationRequestEvent from 'src/vacation-requests/events/vacation-request-event.enum';
import { VacationRequestCreatedEvent } from 'src/vacation-requests/events/vacation-request.events';
import TeamsService from 'src/teams/services/teams.service';
import { WorkflowStepType } from 'src/request-workflows/types/request-workflow-step.interface';
import {
  ICreateWorkflowParams,
  RequestWorkflowService,
} from 'src/request-workflows/services/request-workflow.service';

@Injectable()
export class VacationRequestProcessingService {
  public constructor(
    private readonly teamsService: TeamsService,
    private readonly requestWorkflowService: RequestWorkflowService,
  ) {}

  @OnEvent(VacationRequestEvent.Created)
  public async handleRequestCreated({ request }: VacationRequestCreatedEvent) {
    const team = await this.teamsService.findOne({
      id: request.team!.id,
      slackTeamId: request.slack_team_id,
    });

    if (!team) {
      return;
    }

    const {
      manager_approvers,
      manager_approvers_rule,
      hr_approvers,
      hr_approvers_rule,
      approval_notification_recipients,
    } = team;

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
        comment: request.comment || '',
        days: request.days,
        working_days: request.working_days,
      },
      levels: [],
    };

    if (manager_approvers && manager_approvers.length > 0) {
      const managerLevel = {
        rule: manager_approvers_rule,
        steps: manager_approvers.map((slackUserId) => ({
          slackUserId,
          stepType: WorkflowStepType.Approver,
        })),
      };

      workflow.levels.push(managerLevel);
    }

    if (hr_approvers && hr_approvers.length > 0) {
      const hrLevel = {
        rule: hr_approvers_rule,
        steps: hr_approvers.map((slackUserId) => ({
          slackUserId,
          stepType: WorkflowStepType.Approver,
        })),
      };

      workflow.levels.push(hrLevel);
    }

    if (
      approval_notification_recipients &&
      approval_notification_recipients.length > 0
    ) {
      const notificationLevel = {
        steps: approval_notification_recipients.map((slackUserId) => ({
          slackUserId,
          stepType: WorkflowStepType.Notifier,
        })),
      };
      workflow.levels.push(notificationLevel);
    }

    if (workflow.levels.length === 0) {
      return;
    }

    await this.requestWorkflowService.create(workflow);
  }
}
