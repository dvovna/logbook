import { Injectable } from '@nestjs/common';
import { WorkflowStepProcessor } from 'src/request-workflows/decorators/workflow-step-handler.decorator';
import {
  IRequestWorkflowStepViewModel,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { IWorkflowStepProcessor } from 'src/request-workflows/types/workflow-step-handler.interface';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';

@Injectable()
@WorkflowStepProcessor(WorkflowStepType.Notifier)
export class NotifierStepProcessor implements IWorkflowStepProcessor {
  public constructor(
    private readonly communicationService: SlackCommunicationService,
    private readonly requestWorkflowService: RequestWorkflowService,
  ) {}

  public supports(step: IRequestWorkflowStepViewModel): boolean {
    return step.step_type === WorkflowStepType.Notifier;
  }

  public async process(step: IRequestWorkflowStepViewModel): Promise<void> {
    const message = {
      text: `Vacation request for ${step.step_data.snapshot.user_name} (${step.step_data.snapshot.start_date} → ${step.step_data.snapshot.end_date}, ${step.step_data.snapshot.days} days, ${step.step_data.snapshot.working_days} working days, ${step.step_data.snapshot.type}) has been approved.`,
    };

    await this.communicationService.postEphemeral(
      step.slack_user_id,
      message,
      step.slack_team_id,
    );

    // await this.requestWorkflowService.completeStep(step, true);
  }
}
