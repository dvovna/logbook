import { RequestWorkflowStepCommentsRepository } from '@modules/request-workflows/repositories/request-workflow-step-comments.repository';
import { Injectable } from '@nestjs/common';
import { SupabaseFilter } from '@common/repositories/base.repository';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RequestWorkflowStepCommentAddedEvent } from '@modules/request-workflows/events/request-workflow-step-comment.events';
import { WorkflowStepCommentEvent } from '@modules/request-workflows/enums/workflow-step-comment-event.enum';
import { ValidationError } from '@common/errors/validation.error';

interface ICreateParams {
  requestId: string;
  slackUserId: string;
  slackTeamId: string;
  stepId: string;
  stepLevel: number;
  createdBy: string;
  comment: string;
}

interface IFindParams {
  id?: string;
  stepId?: string;
  requestId?: string;
  stepLevel?: number;
  slackUserId?: string;
  userId?: string;
  slackTeamId: string;
}

const MAX_COMMENTS_PER_STEP = 10;

@Injectable()
export class RequestWorkflowStepCommentsService {
  public constructor(
    private readonly requestWorkflowStepCommentsRepository: RequestWorkflowStepCommentsRepository,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  public async create(commentData: ICreateParams) {
    const stepCommentsTotal =
      await this.requestWorkflowStepCommentsRepository.count({
        request_id: commentData.requestId,
        slack_team_id: commentData.slackTeamId,
        step_id: commentData.stepId,
      });

    if (stepCommentsTotal >= MAX_COMMENTS_PER_STEP) {
      throw new ValidationError('Comment limit reached for this step');
    }

    const comment = await this.requestWorkflowStepCommentsRepository.create({
      request_id: commentData.requestId,
      slack_team_id: commentData.slackTeamId,
      slack_user_id: commentData.slackUserId,
      step_id: commentData.stepId,
      step_level: commentData.stepLevel,
      created_by: commentData.createdBy,
      comment: commentData.comment,
    });

    this.eventEmitter.emit(
      WorkflowStepCommentEvent.Added,
      new RequestWorkflowStepCommentAddedEvent(comment),
    );

    return comment;
  }

  public findOne(params: IFindParams) {
    return this.requestWorkflowStepCommentsRepository.findOne(
      this.getFindQuery(params),
    );
  }

  public findMany(params: IFindParams) {
    return this.requestWorkflowStepCommentsRepository.findMany(
      this.getFindQuery(params),
      { orderBy: ['created_at:asc'] },
    );
  }

  private getFindQuery(params: IFindParams): SupabaseFilter {
    return {
      ...(params.id && { id: params.id }),
      ...(params.stepId && { step_id: params.stepId }),
      ...(params.stepLevel && { step_level: params.stepLevel }),
      ...(params.requestId && { request_id: params.requestId }),
      ...(params.slackUserId && { slack_user_id: params.slackUserId }),
      slack_team_id: params.slackTeamId,
    };
  }
}
