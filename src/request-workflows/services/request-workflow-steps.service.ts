import {
  ApproverStepStatus,
  IApproverStepData,
  WorkflowStepType,
} from 'src/request-workflows/types/request-workflow-step.interface';
import { RequestWorkflowStepsRepository } from 'src/request-workflows/repositories/request-workflow-steps.repository';
import { Json } from 'src/common/types/database.types';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IQueryOptions,
  SupabaseFilter,
  Tables,
} from 'src/common/repositories/base.repository';
import { IUserViewModel } from 'src/users/types/user.interface';

export interface ICreateParams {
  requestId: string;
  slackUserId: string;
  slackTeamId: string;
  stepLevel: number;
  stepType: WorkflowStepType;
  stepData?: IApproverStepData;
}

interface IUpdateParams {
  slackMessageTs?: string;
  slackChannelId?: string;
  processedAt?: string;
  stepData?: IApproverStepData;
  completedAt?: string;
}

interface IFindParams {
  id?: string;
  requestId?: string;
  slackUserId?: string;
  processed?: boolean;
  stepLevel?: number;
  stepType?: WorkflowStepType;
  slackTeamId: string;
  completed?: boolean;
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

  public count(findParams: IFindParams) {
    return this.requestWorkflowStepsRepository.count(
      this.getFindQuery(findParams),
    );
  }

  public update(findParams: IFindParams, updateData: IUpdateParams) {
    return this.requestWorkflowStepsRepository.update(
      this.getFindQuery(findParams),
      {
        ...(updateData.completedAt
          ? { completed_at: updateData.completedAt }
          : {}),
        ...(updateData.slackMessageTs
          ? { slack_message_ts: updateData.slackMessageTs }
          : {}),
        ...(updateData.slackChannelId
          ? { slack_channel_id: updateData.slackChannelId }
          : {}),
        ...(updateData.processedAt
          ? { processed_at: updateData.processedAt }
          : {}),
        updated_at: new Date().toISOString(),
        ...(updateData.stepData
          ? { step_data: updateData.stepData as unknown as Json | undefined }
          : {}),
      },
    );
  }

  public async updateStatus(
    findParams: IFindParams,
    status: Exclude<ApproverStepStatus, 'pending'>,
    decidedBy: IUserViewModel,
  ) {
    const stepsToUpdate = await this.requestWorkflowStepsRepository.findMany(
      this.getFindQuery(findParams),
    );

    if (stepsToUpdate.length === 0) {
      return [];
    }

    return await Promise.all(
      stepsToUpdate.map((step) => {
        return this.requestWorkflowStepsRepository.update(
          {
            id: step.id,
            slack_team_id: step.slack_team_id,
            request_id: step.request_id,
          },
          {
            step_data: {
              ...step.step_data,
              status,
              decided_at: new Date().toISOString(),
              decided_by_slack_id: decidedBy.slack_id,
            },
          } as unknown as Tables['request_workflow_steps']['Update'],
        );
      }),
    );
  }

  public findOne(findParams: IFindParams) {
    return this.requestWorkflowStepsRepository.findOne(
      this.getFindQuery(findParams),
    );
  }

  public findMany(findParams: IFindParams, options: IQueryOptions = {}) {
    return this.requestWorkflowStepsRepository.findMany(
      this.getFindQuery(findParams),
      {
        orderBy: ['step_level:asc'],
        ...options,
      },
    );
  }

  public async findOneWithValidation(findParams: IFindParams) {
    const step = await this.findOne(findParams);

    if (!step) {
      throw new NotFoundException('Workflow step not found');
    }

    return step;
  }

  private getFindQuery(params: IFindParams) {
    return {
      slack_team_id: params.slackTeamId,
      ...(params.id ? { id: params.id } : {}),
      ...(params.requestId ? { request_id: params.requestId } : {}),
      ...(params.slackUserId ? { slack_user_id: params.slackUserId } : {}),
      ...(params.stepLevel !== undefined
        ? { step_level: params.stepLevel }
        : {}),
      ...(params.stepType ? { step_type: params.stepType } : {}),
      ...(params.completed !== undefined
        ? {
          completed_at: params.completed
            ? { operator: 'not.is', value: null }
            : { operator: 'is', value: null },
        }
        : {}),
      ...(params.processed !== undefined
        ? {
          processed_at: params.processed
            ? { operator: 'not.is', value: null }
            : { operator: 'is', value: null },
        }
        : {}),
    } as SupabaseFilter;
  }
}
