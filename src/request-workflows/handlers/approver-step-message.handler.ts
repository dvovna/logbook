import { Injectable } from '@nestjs/common';
import { IUserViewModel } from 'src/users/types/user.interface';
import { SlackHandler } from 'src/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from 'src/slack/enums/integration-callback-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from 'src/slack/common/handlers/base-action.handler';
import { ApproverMessageActionId } from 'src/request-workflows/enums/approver-message-action-id.enum';
import { withButtonAction } from 'src/slack/common/utils/view.utils';
import { RequestWorkflowService } from 'src/request-workflows/services/request-workflow.service';
import SlackCommunicationService from 'src/slack-communication/services/slack-communication.service';
import { ApproverStepCommentModalView } from 'src/request-workflows/views/approver-step-comment-modal.view';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.WorkflowStepMessage,
  type: 'block_actions',
})
export class ApproverStepMessageHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  public constructor(
    private readonly requestWorkflowService: RequestWorkflowService,
    private readonly slackCommunicationService: SlackCommunicationService,
    private readonly approverStepCommentModalView: ApproverStepCommentModalView,
  ) {
    super();

    this.actionMap = {
      [ApproverMessageActionId.Approve]: withButtonAction(this.handleApprove),
      [ApproverMessageActionId.Reject]: withButtonAction(this.handleReject),
      [ApproverMessageActionId.AddComment]: withButtonAction(
        this.handleAddComment,
      ),
    };
  }

  private handleApprove = async (stepId: string, user: IUserViewModel) => {
    await this.requestWorkflowService.approveStep(stepId, user);
  };

  private handleReject = async (stepId: string, user: IUserViewModel) => {
    await this.requestWorkflowService.rejectStep(stepId, user);
  };

  private handleAddComment = async (
    stepId: string,
    user: IUserViewModel,
    triggerId: string,
  ) => {
    await this.slackCommunicationService.openView(
      triggerId,
      this.approverStepCommentModalView.getView(
        {},
        {
          stepId,
        },
      ),
      user.slack_team_id,
    );
  };
}
