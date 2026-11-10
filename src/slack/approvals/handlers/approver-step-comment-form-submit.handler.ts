import type { ViewResponseAction } from '@slack/bolt/dist/types/view';
import { Injectable } from '@nestjs/common';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import { IUserViewModel } from '@modules/users/types/user.interface';
import SlackViewResponseFactory from '@modules/slack/factories/slack-response.factory';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import { BaseModalFormSubmitHandler } from '@modules/slack/common/handlers/base-modal-view-submit.handler';
import UserRole from '@common/enums/user-role.enum';
import CommentModalViewValuesParser, {
  ICommentFormViewData,
} from '@modules/slack/approvals/parsers/comment-modal-view-values.parser';
import { IWorkflowStepCommentViewModel } from '@modules/request-workflows/types/workflow-step-comment.interface';
import { RequestWorkflowStepCommentsService } from '@modules/request-workflows/services/request-workflow-step-comments.service';
import {
  ApproverStepCommentModalView,
  IApproverStepCommentModalViewMetadata,
} from '@modules/slack/approvals/views/approver-step-comment-modal.view';
import { RequestWorkflowStepsService } from '@modules/request-workflows/services/request-workflow-steps.service';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.ApproverMessageCommentFormSubmit,
  type: 'view_submission',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
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
    private readonly requestWorkflowService: RequestWorkflowService,
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

    this.requestWorkflowService.assertCanActOnStep(step, user);

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

  protected successResponse(): ViewResponseAction {
    return SlackViewResponseFactory.success();
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
