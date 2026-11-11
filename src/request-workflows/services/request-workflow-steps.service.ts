import {
  IApproverStepData,
  WorkflowStepType,
} from '@modules/request-workflows/types/request-workflow-step.interface';
import { RequestWorkflowStepsRepository } from '@modules/request-workflows/repositories/request-workflow-steps.repository';
import { Json } from '@common/types/database.types';
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  IQueryOptions,
  RepositoryFilter,
} from '@common/repositories/repository.types';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { RequestWorkflowStatus } from '@common/enums/request-workflow-status.enum';
import { ISearchParams } from '@common/types/pagination.types';

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

type ISearchStepsParams = ISearchParams<IFindParams>;

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
          step_data: stepData as NonNullable<Json> | undefined,
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
          ? { step_data: updateData.stepData as unknown as NonNullable<Json> }
          : {}),
      },
    );
  }

  // Marks the steps that nobody has processed yet as processed and returns
  // them, in one statement: of two callers at once, only the first gets them.
  public claimUnprocessed(findParams: IFindParams) {
    return this.requestWorkflowStepsRepository.updateMany(
      this.getFindQuery({ ...findParams, processed: false }),
      { processed_at: new Date().toISOString() },
    );
  }

  // Decides the open steps of a request in one statement: one step
  // (`stepId`), one level (`stepLevel`) or all of them. A step that is
  // already closed is left alone, so of two people who decide at once only
  // the first changes anything. Returns the steps it decided.
  public decide(
    {
      requestId,
      slackTeamId,
      stepId,
      stepLevel,
    }: {
      requestId: string;
      slackTeamId: string;
      stepId?: string;
      stepLevel?: number;
    },
    status: RequestWorkflowStatus,
    decidedBy: IUserViewModel,
    rejectionReason?: string,
  ) {
    return this.requestWorkflowStepsRepository.decide({
      slackTeamId,
      requestId,
      status,
      decidedBySlackId: decidedBy.slack_id,
      rejectionReason,
      stepId,
      stepLevel,
    });
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

  // The open steps that wait for this approver, oldest first. Nobody
  // approves their own request; a step made for the requester before that
  // rule (assertNotOwnRequest refuses it) is left out, so it doesn't sit in
  // their Approvals forever.
  public findWaitingFor(approver: { slack_id: string; slack_team_id: string }) {
    return this.requestWorkflowStepsRepository.findWaitingFor(
      approver.slack_team_id,
      approver.slack_id,
    );
  }

  // How many steps findWaitingFor finds, counted in the database.
  public countWaitingFor(approver: {
    slack_id: string;
    slack_team_id: string;
  }) {
    return this.requestWorkflowStepsRepository.countWaitingFor(
      approver.slack_team_id,
      approver.slack_id,
    );
  }

  public search(params: ISearchStepsParams) {
    return this.requestWorkflowStepsRepository.search({
      filters: this.getFindQuery(params.filters),
      page: params.page,
      pageSize: params.pageSize,
      orderBy: params.orderBy,
      searchTerm: params.searchTerm,
    });
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
    } as RepositoryFilter;
  }
}
