import {
  IApproverStepData,
  INotifierStepData,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { RequestWorkflowStepsRepository } from 'src/request-workflows/repositories/request-workflow-steps.repository';
import { Json } from 'src/common/types/database.types';
import { Injectable } from '@nestjs/common';

interface ICreateParams {
  requestId: string;
  slackUserId: string;
  slackTeamId: string;
  stepLevel: number;
  stepType: WorkflowStepType;
  stepData?: IApproverStepData | INotifierStepData;
}

@Injectable()
export class RequestWorkflowStepsService {
  public constructor(
    private readonly requestWorkflowStepsRepository: RequestWorkflowStepsRepository,
  ) {}

  public async createMany(createParams: ICreateParams[]) {
    const timestamp = new Date().toISOString();

    return this.requestWorkflowStepsRepository.createMany(
      createParams.map(
        ({
          requestId,
          slackUserId,
          stepLevel,
          stepType,
          stepData,
          slackTeamId,
        }) => ({
          request_id: requestId,
          slack_team_id: slackTeamId,
          slack_user_id: slackUserId,
          step_level: stepLevel,
          step_type: stepType,
          step_data: stepData as Json | undefined,
          created_at: timestamp,
          updated_at: timestamp,
        }),
      ),
    );
  }
}
