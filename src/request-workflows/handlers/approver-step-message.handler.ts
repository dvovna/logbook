import { Injectable, Logger } from '@nestjs/common';
import { IUserViewModel } from '@modules/users/types/user.interface';
import { SlackHandler } from '@modules/slack/decorators/slack-handler.decorator';
import { ViewCallbackId } from '@modules/slack/enums/integration-callback-id.enum';
import {
  ActionMapType,
  BaseActionHandler,
} from '@modules/slack/common/handlers/base-action.handler';
import { ApproverMessageActionId } from '@modules/request-workflows/enums/approver-message-action-id.enum';
import { withButtonAction } from '@modules/slack/common/utils/view.utils';
import { RequestWorkflowService } from '@modules/request-workflows/services/request-workflow.service';
import SlackCommunicationService from '@modules/slack-communication/services/slack-communication.service';
import { ApproverStepCommentModalView } from '@modules/request-workflows/views/approver-step-comment-modal.view';
import UserRole from '@common/enums/user-role.enum';
import { runInBackground } from '@common/utils/run-in-background';

@Injectable()
@SlackHandler({
  callbackId: ViewCallbackId.WorkflowStepMessage,
  type: 'block_actions',
  allowedRoles: [UserRole.Admin, UserRole.HR, UserRole.Manager],
})
export class ApproverStepMessageHandler extends BaseActionHandler {
  protected actionMap: ActionMapType;

  private readonly logger = new Logger(ApproverStepMessageHandler.name);

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

  // Deciding a step updates every approver's message and notifies the next
  // level, which can take longer than Slack waits for the click's answer.
  private handleApprove = (stepId: string, user: IUserViewModel) => {
    runInBackground(this.logger, `approve step ${stepId}`, () =>
      this.requestWorkflowService.approveStep(stepId, user),
    );
  };

  private handleReject = (stepId: string, user: IUserViewModel) => {
    runInBackground(this.logger, `reject step ${stepId}`, () =>
      this.requestWorkflowService.rejectStep(stepId, user),
    );
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
