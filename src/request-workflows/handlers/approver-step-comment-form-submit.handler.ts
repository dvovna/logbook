import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import SlackViewResponseFactory from 'src/slack/factories/slack-response.factory';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from 'src/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from 'src/common/enums/user-role.enum';
import CommentModalViewValuesParser, {
  ICommentFormViewData,
} from 'src/request-workflows/parsers/comment-modal-view-values.parser';
import { IWorkflowStepCommentViewModel } from 'src/request-workflows/types/workflow-step-comment.interface';
import { RequestWorkflowStepCommentsService } from 'src/request-workflows/services/request-workflow-step-comments.service';
import {
  ApproverStepCommentModalView,
  IApproverStepCommentModalViewMetadata,
} from 'src/request-workflows/views/approver-step-comment-modal.view';
import { RequestWorkflowStepsService } from 'src/request-workflows/services/request-workflow-steps.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApproverMessageCommentFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR],
})
export class ApproverStepCommentFormSubmitHandler extends BaseModalFormSubmitHandler<
  never,
  ICommentFormViewData,
  IWorkflowStepCommentViewModel
> {
  public constructor(
    private readonly requestWorkflowStepCommentsService: RequestWorkflowStepCommentsService,
    private readonly requestWorkflowStepsService: RequestWorkflowStepsService,
    private readonly approverStepCommentModalView: ApproverStepCommentModalView,
    commentModalViewValuesParser: CommentModalViewValuesParser,
  ) {
    super(commentModalViewValuesParser);
  }

  protected async onSubmit(
    data: ICommentFormViewData,
    metadata: IApproverStepCommentModalViewMetadata,
    user: IUserViewModel,
  ): Promise<IWorkflowStepCommentViewModel> {
    const step = await this.requestWorkflowStepsService.findOneWithValidation({
      id: metadata.stepId,
      slackTeamId: user.slack_team_id,
    });

    return await this.requestWorkflowStepCommentsService.create({
      stepId: step.id,
      comment: data.comment,
      slackTeamId: user.slack_team_id,
      slackUserId: user.slack_id,
      requestId: step.request_id,
      stepLevel: step.step_level,
      createdBy: user.id,
    });
  }

  protected successResponse() {
    return SlackViewResponseFactory.update(
      this.approverStepCommentModalView.getSuccessView(
        '✅ Comment was created successfully!',
      ),
    );
  }

  protected errorResponse(
    errorMessage: string,
    _data: ICommentFormViewData,
    metadata: IApproverStepCommentModalViewMetadata,
  ) {
    return SlackViewResponseFactory.update(
      this.approverStepCommentModalView.getView(
        {
          errorMessage,
        },
        metadata,
      ),
    );
  }
}
